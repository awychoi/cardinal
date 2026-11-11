//! macOS Keychain storage for provider credentials.
//!
//! Every app-managed secret — the Sandbox and Trial/Production client ID/secret
//! pairs and one access token per connection — lives in a **single**
//! generic-password item (`plaid-credentials-v1`) whose data is a small JSON
//! document. macOS authorizes each Keychain item against the calling
//! application's code signature, and asks once per item, so the item count is
//! the number of approvals a new build needs: one item, one approval, however
//! many cards or connections the vault holds.
//!
//! Layout, migration, and caching:
//! - the document is `{"v":1,"items":{"<account>":"<secret>"}}`; a malformed or
//!   unknown-version document fails closed instead of starting empty;
//! - items written by an older build (one per account) are migrated on first
//!   load and then deleted — the document is written *before* anything is
//!   deleted, so a denied prompt cannot lose a credential;
//! - the document is cached in Rust memory for one unlocked session and dropped
//!   by `clear_cache` on lock, so a session costs at most one Keychain access.
//!
//! Values never enter the ledger, renderer, logs, URLs, or exports.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::security::crypto::SecretString;

pub const KEYCHAIN_SERVICE: &str = "com.awychoi.cardiganmoney.plaid";

#[cfg(target_os = "macos")]
extern "C" {
    static kSecAttrAccessible: core_foundation_sys::string::CFStringRef;
    static kSecMatchLimitOne: core_foundation_sys::string::CFStringRef;
}
/// Plaid client credentials are stored per environment. Sandbox and
/// Production (including Trial) use different secrets and different hosts, so
/// they are separate document keys that can never be mixed up.
pub const ACCOUNT_CLIENT_ID_SANDBOX: &str = "plaid-client-id-sandbox";
pub const ACCOUNT_SECRET_SANDBOX: &str = "plaid-secret-sandbox";
pub const ACCOUNT_CLIENT_ID_PRODUCTION: &str = "plaid-client-id-production";
pub const ACCOUNT_SECRET_PRODUCTION: &str = "plaid-secret-production";

/// One access token per connection, keyed by the connection's credential
/// reference. A prefix so restore can delete every token without reading them.
pub const TOKEN_ACCOUNT_PREFIX: &str = "plaid-access-token-";

/// Every app-managed Plaid client credential. Used by crypto-erase, which must
/// not leave either environment's secret behind.
pub const PLAID_CLIENT_ACCOUNTS: &[&str] = &[
    ACCOUNT_CLIENT_ID_SANDBOX,
    ACCOUNT_SECRET_SANDBOX,
    ACCOUNT_CLIENT_ID_PRODUCTION,
    ACCOUNT_SECRET_PRODUCTION,
];

/// The single Keychain item that holds every app-managed provider secret.
pub const CONSOLIDATED_ACCOUNT: &str = "plaid-credentials-v1";
const DOCUMENT_VERSION: u8 = 1;
const MAX_ITEMS: usize = 32;
const MAX_ACCOUNT_CHARS: usize = 128;
const MAX_SECRET_CHARS: usize = 8192;

pub trait CredentialStore: Send + Sync {
    fn set(&self, account: &str, secret: &SecretString) -> AppResult<()>;
    fn get(&self, account: &str) -> AppResult<Option<SecretString>>;
    fn delete(&self, account: &str) -> AppResult<()>;
    /// Delete every app-managed credential whose account name starts with
    /// `prefix`. Used by the destructive no-passphrase restore path, which
    /// cannot read the old ledger to discover credential references.
    fn delete_prefix(&self, prefix: &str) -> AppResult<usize>;
    /// Drop any memoised reads. Called when the session locks so the secrets do
    /// not outlive the unlocked vault. Stateless stores have nothing to do.
    fn clear_cache(&self) {}
}

#[derive(Debug, Default)]
pub struct MemoryStore {
    values: Mutex<HashMap<String, String>>,
}

impl CredentialStore for MemoryStore {
    fn set(&self, account: &str, secret: &SecretString) -> AppResult<()> {
        let mut values = self.values.lock().map_err(|_| AppError::Internal)?;
        values.insert(account.to_string(), secret.expose().to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> AppResult<Option<SecretString>> {
        let values = self.values.lock().map_err(|_| AppError::Internal)?;
        Ok(values.get(account).cloned().map(SecretString::new))
    }

    fn delete(&self, account: &str) -> AppResult<()> {
        let mut values = self.values.lock().map_err(|_| AppError::Internal)?;
        values.remove(account);
        Ok(())
    }

    fn delete_prefix(&self, prefix: &str) -> AppResult<usize> {
        let mut values = self.values.lock().map_err(|_| AppError::Internal)?;
        let before = values.len();
        values.retain(|account, _| !account.starts_with(prefix));
        Ok(before - values.len())
    }
}

/// One Keychain item, addressed by account name under the app's service.
pub(crate) trait ItemBackend: Send + Sync {
    fn read(&self, account: &str) -> AppResult<Option<String>>;
    fn write(&self, account: &str, value: &str) -> AppResult<()>;
    fn remove(&self, account: &str) -> AppResult<()>;
    /// Account names stored for the service whose name starts with `prefix`.
    /// Used only to migrate items written by an older build.
    fn accounts_with_prefix(&self, prefix: &str) -> AppResult<Vec<String>>;
}

#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct KeychainBackend;

impl ItemBackend for KeychainBackend {
    fn read(&self, account: &str) -> AppResult<Option<String>> {
        keychain_get(KEYCHAIN_SERVICE, account)
    }

    fn write(&self, account: &str, value: &str) -> AppResult<()> {
        keychain_put(KEYCHAIN_SERVICE, account, value.as_bytes())
    }

    fn remove(&self, account: &str) -> AppResult<()> {
        keychain_delete(KEYCHAIN_SERVICE, account)
    }

    fn accounts_with_prefix(&self, prefix: &str) -> AppResult<Vec<String>> {
        keychain_accounts_with_prefix(KEYCHAIN_SERVICE, prefix)
    }
}

#[derive(Serialize, Deserialize)]
struct StoredDocument {
    v: u8,
    items: BTreeMap<String, String>,
}

fn parse_document(raw: &str) -> AppResult<BTreeMap<String, SecretString>> {
    let document: StoredDocument = serde_json::from_str(raw).map_err(|_| AppError::Keychain)?;
    if document.v != DOCUMENT_VERSION || document.items.len() > MAX_ITEMS {
        return Err(AppError::Keychain);
    }
    let mut items = BTreeMap::new();
    for (account, secret) in document.items {
        let account_len = account.chars().count();
        let secret_len = secret.chars().count();
        if account_len == 0
            || account_len > MAX_ACCOUNT_CHARS
            || secret_len == 0
            || secret_len > MAX_SECRET_CHARS
        {
            return Err(AppError::Keychain);
        }
        items.insert(account, SecretString::new(secret));
    }
    Ok(items)
}

/// Credential store backed by one JSON document in one Keychain item.
///
/// The document is loaded once per session and kept in memory; every
/// mutation writes the whole document back (so the item and its grant are
/// reused, and no new item appears when a connection is added), and removing
/// the last entry deletes the item.
pub(crate) struct DocumentStore<B: ItemBackend> {
    backend: B,
    cache: Mutex<Option<BTreeMap<String, SecretString>>>,
}

impl<B: ItemBackend + Default> Default for DocumentStore<B> {
    fn default() -> Self {
        Self::new(B::default())
    }
}

impl<B: ItemBackend> DocumentStore<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            cache: Mutex::new(None),
        }
    }

    fn guard(
        &self,
    ) -> AppResult<std::sync::MutexGuard<'_, Option<BTreeMap<String, SecretString>>>> {
        self.cache.lock().map_err(|_| AppError::Internal)
    }

    /// Load the document once; later calls use the cached copy.
    fn ensure_loaded(&self) -> AppResult<()> {
        if self.guard()?.is_some() {
            return Ok(());
        }
        // No lock is held across the Keychain access: a prompt can block for as
        // long as the user takes.
        let loaded = self.load()?;
        *self.guard()? = Some(loaded);
        Ok(())
    }

    fn load(&self) -> AppResult<BTreeMap<String, SecretString>> {
        if let Some(raw) = self.backend.read(CONSOLIDATED_ACCOUNT)? {
            return parse_document(&raw);
        }
        self.migrate_legacy()
    }

    /// Move items written by an older build (one per account) into the document.
    fn migrate_legacy(&self) -> AppResult<BTreeMap<String, SecretString>> {
        let mut legacy: BTreeMap<String, String> = BTreeMap::new();
        for account in PLAID_CLIENT_ACCOUNTS {
            if let Some(value) = self.backend.read(account)? {
                legacy.insert((*account).to_string(), value);
            }
        }
        for account in self.backend.accounts_with_prefix(TOKEN_ACCOUNT_PREFIX)? {
            if let Some(value) = self.backend.read(&account)? {
                legacy.insert(account, value);
            }
        }
        if legacy.is_empty() {
            return Ok(BTreeMap::new());
        }
        let items: BTreeMap<String, SecretString> = legacy
            .into_iter()
            .map(|(account, secret)| (account, SecretString::new(secret)))
            .collect();
        // Write the document before deleting anything: if a prompt is denied or
        // the write fails, the old items stay the source of truth.
        self.persist(&items)?;
        self.remove_legacy();
        Ok(items)
    }

    /// Best-effort cleanup after a migration. A denial leaves a stale copy that
    /// the next session ignores, because the document already exists.
    fn remove_legacy(&self) {
        for account in PLAID_CLIENT_ACCOUNTS {
            let _ = self.backend.remove(account);
        }
        if let Ok(accounts) = self.backend.accounts_with_prefix(TOKEN_ACCOUNT_PREFIX) {
            for account in accounts {
                let _ = self.backend.remove(&account);
            }
        }
    }

    fn snapshot(&self) -> AppResult<BTreeMap<String, SecretString>> {
        let guard = self.guard()?;
        let items = guard.as_ref().ok_or(AppError::Internal)?;
        Ok(items
            .iter()
            .map(|(account, secret)| {
                (
                    account.clone(),
                    SecretString::new(secret.expose().to_string()),
                )
            })
            .collect())
    }

    fn persist(&self, items: &BTreeMap<String, SecretString>) -> AppResult<()> {
        let document = StoredDocument {
            v: DOCUMENT_VERSION,
            items: items
                .iter()
                .map(|(account, secret)| (account.clone(), secret.expose().to_string()))
                .collect(),
        };
        let raw = serde_json::to_string(&document).map_err(|_| AppError::Keychain)?;
        self.backend.write(CONSOLIDATED_ACCOUNT, &raw)
    }

    /// Write a new document and adopt it only once the write succeeded.
    fn commit(&self, next: BTreeMap<String, SecretString>) -> AppResult<()> {
        if next.is_empty() {
            self.backend.remove(CONSOLIDATED_ACCOUNT)?;
        } else {
            self.persist(&next)?;
        }
        *self.guard()? = Some(next);
        Ok(())
    }
}

impl<B: ItemBackend> CredentialStore for DocumentStore<B> {
    fn set(&self, account: &str, secret: &SecretString) -> AppResult<()> {
        self.ensure_loaded()?;
        let mut next = self.snapshot()?;
        next.insert(
            account.to_string(),
            SecretString::new(secret.expose().to_string()),
        );
        self.commit(next)
    }

    fn get(&self, account: &str) -> AppResult<Option<SecretString>> {
        self.ensure_loaded()?;
        let guard = self.guard()?;
        let items = guard.as_ref().ok_or(AppError::Internal)?;
        Ok(items
            .get(account)
            .map(|secret| SecretString::new(secret.expose().to_string())))
    }

    fn delete(&self, account: &str) -> AppResult<()> {
        self.ensure_loaded()?;
        let mut next = self.snapshot()?;
        if next.remove(account).is_none() {
            return Ok(());
        }
        self.commit(next)
    }

    fn delete_prefix(&self, prefix: &str) -> AppResult<usize> {
        self.ensure_loaded()?;
        let mut next = self.snapshot()?;
        let before = next.len();
        next.retain(|account, _| !account.starts_with(prefix));
        let removed = before - next.len();
        if removed > 0 {
            self.commit(next)?;
        }
        Ok(removed)
    }

    fn clear_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
    }
}

/// The production credential store: one Keychain item for every Plaid secret.
pub(crate) type KeychainStore = DocumentStore<KeychainBackend>;

#[cfg(target_os = "macos")]
fn keychain_put(service: &str, account: &str, value: &[u8]) -> AppResult<()> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::CFData;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use security_framework_sys::access_control::kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
    use security_framework_sys::base::{errSecDuplicateItem, errSecSuccess};
    use security_framework_sys::item::{
        kSecAttrAccount, kSecAttrService, kSecAttrSynchronizable, kSecClass,
        kSecClassGenericPassword, kSecValueData,
    };
    use security_framework_sys::keychain_item::{SecItemAdd, SecItemUpdate};

    let query_pairs = |include_value: bool| -> Vec<(CFString, CFType)> {
        let mut pairs: Vec<(CFString, CFType)> = vec![
            (
                unsafe { CFString::wrap_under_get_rule(kSecClass) },
                unsafe { CFString::wrap_under_get_rule(kSecClassGenericPassword) }.into_CFType(),
            ),
            (
                unsafe { CFString::wrap_under_get_rule(kSecAttrService) },
                CFString::new(service).into_CFType(),
            ),
            (
                unsafe { CFString::wrap_under_get_rule(kSecAttrAccount) },
                CFString::new(account).into_CFType(),
            ),
            (
                unsafe { CFString::wrap_under_get_rule(kSecAttrSynchronizable) },
                CFBoolean::from(false).into_CFType(),
            ),
        ];
        if include_value {
            pairs.push((
                unsafe { CFString::wrap_under_get_rule(kSecValueData) },
                CFData::from_buffer(value).into_CFType(),
            ));
        }
        pairs
    };

    let mut add_pairs = query_pairs(true);
    // The accessibility class is set when the item is created. Updates keep it,
    // and the migration never updates an older build's item, so the class can
    // not be inherited from something weaker.
    add_pairs.push((
        unsafe { CFString::wrap_under_get_rule(kSecAttrAccessible) },
        unsafe { CFString::wrap_under_get_rule(kSecAttrAccessibleWhenUnlockedThisDeviceOnly) }
            .into_CFType(),
    ));
    let add = CFDictionary::<CFString, CFType>::from_CFType_pairs(&add_pairs);
    let status = unsafe { SecItemAdd(add.as_concrete_TypeRef(), std::ptr::null_mut()) };
    if status == errSecSuccess {
        return Ok(());
    }
    if status != errSecDuplicateItem {
        return Err(AppError::Keychain);
    }

    // Reuse the existing item so its Keychain grant (and accessibility class)
    // survive every credential write.
    let query = CFDictionary::<CFString, CFType>::from_CFType_pairs(&query_pairs(false));
    let update_pairs = vec![(
        unsafe { CFString::wrap_under_get_rule(kSecValueData) },
        CFData::from_buffer(value).into_CFType(),
    )];
    let update = CFDictionary::<CFString, CFType>::from_CFType_pairs(&update_pairs);
    let status =
        unsafe { SecItemUpdate(query.as_concrete_TypeRef(), update.as_concrete_TypeRef()) };
    if status == errSecSuccess {
        Ok(())
    } else {
        Err(AppError::Keychain)
    }
}

#[cfg(target_os = "macos")]
fn keychain_accounts_with_prefix(service: &str, account_prefix: &str) -> AppResult<Vec<String>> {
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use core_foundation_sys::base::CFTypeRef;
    use core_foundation_sys::string::CFStringRef;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};
    use security_framework_sys::item::kSecAttrAccount;

    let mut options = ItemSearchOptions::new();
    options
        .class(ItemClass::generic_password())
        .service(service)
        .load_attributes(true)
        .limit(Limit::All);
    let results = options.search().map_err(|_| AppError::Keychain)?;
    let key = unsafe { kSecAttrAccount as *const std::ffi::c_void };
    let mut accounts = Vec::new();
    for result in results {
        let SearchResult::Dict(dict) = result else {
            continue;
        };
        let dict: CFDictionary = dict.into_untyped();
        let Some(value) = dict.find(key) else {
            continue;
        };
        let raw: CFTypeRef = *value as CFTypeRef;
        if raw.is_null() {
            continue;
        }
        let account = unsafe { CFString::wrap_under_get_rule(raw as CFStringRef) }.to_string();
        if account.starts_with(account_prefix) {
            accounts.push(account);
        }
    }
    Ok(accounts)
}

#[cfg(target_os = "macos")]
fn keychain_get(service: &str, account: &str) -> AppResult<Option<String>> {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::{CFData, CFDataRef};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use core_foundation_sys::base::{CFGetTypeID, CFRelease};
    use security_framework_sys::base::{errSecItemNotFound, errSecSuccess};
    use security_framework_sys::item::{
        kSecAttrAccount, kSecAttrService, kSecAttrSynchronizable, kSecClass,
        kSecClassGenericPassword, kSecReturnData,
    };
    use security_framework_sys::keychain_item::SecItemCopyMatching;

    let pairs: Vec<(CFString, CFType)> = vec![
        (
            unsafe { CFString::wrap_under_get_rule(kSecClass) },
            unsafe { CFString::wrap_under_get_rule(kSecClassGenericPassword) }.into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrService) },
            CFString::new(service).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrAccount) },
            CFString::new(account).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrSynchronizable) },
            CFBoolean::from(false).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecReturnData) },
            CFBoolean::from(true).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecMatchLimitOne) },
            unsafe { CFString::wrap_under_get_rule(kSecMatchLimitOne) }.into_CFType(),
        ),
    ];
    let dictionary = CFDictionary::<CFString, CFType>::from_CFType_pairs(&pairs);
    let mut result: CFTypeRef = std::ptr::null();
    let status = unsafe { SecItemCopyMatching(dictionary.as_concrete_TypeRef(), &mut result) };
    if status == errSecItemNotFound {
        return Ok(None);
    }
    if status != errSecSuccess || result.is_null() {
        return Err(AppError::Keychain);
    }
    if unsafe { CFGetTypeID(result) } != CFData::type_id() {
        unsafe { CFRelease(result) };
        return Err(AppError::Keychain);
    }
    let data = unsafe { CFData::wrap_under_create_rule(result as CFDataRef) };
    let bytes = data.bytes().to_vec();
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| AppError::Keychain)
}

#[cfg(target_os = "macos")]
fn keychain_delete(service: &str, account: &str) -> AppResult<()> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;
    use security_framework_sys::base::{errSecItemNotFound, errSecSuccess};
    use security_framework_sys::item::{
        kSecAttrAccount, kSecAttrService, kSecAttrSynchronizable, kSecClass,
        kSecClassGenericPassword,
    };
    use security_framework_sys::keychain_item::SecItemDelete;

    let pairs: Vec<(CFString, CFType)> = vec![
        (
            unsafe { CFString::wrap_under_get_rule(kSecClass) },
            unsafe { CFString::wrap_under_get_rule(kSecClassGenericPassword) }.into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrService) },
            CFString::new(service).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrAccount) },
            CFString::new(account).into_CFType(),
        ),
        (
            unsafe { CFString::wrap_under_get_rule(kSecAttrSynchronizable) },
            CFBoolean::from(false).into_CFType(),
        ),
    ];
    let dictionary = CFDictionary::<CFString, CFType>::from_CFType_pairs(&pairs);
    let status = unsafe { SecItemDelete(dictionary.as_concrete_TypeRef()) };
    if status == errSecSuccess || status == errSecItemNotFound {
        Ok(())
    } else {
        Err(AppError::Keychain)
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_put(_service: &str, _account: &str, _value: &[u8]) -> AppResult<()> {
    Err(AppError::Unsupported)
}

#[cfg(not(target_os = "macos"))]
fn keychain_get(_service: &str, _account: &str) -> AppResult<Option<String>> {
    Err(AppError::Unsupported)
}

#[cfg(not(target_os = "macos"))]
fn keychain_delete(_service: &str, _account: &str) -> AppResult<()> {
    Err(AppError::Unsupported)
}

#[cfg(not(target_os = "macos"))]
fn keychain_accounts_with_prefix(_service: &str, _prefix: &str) -> AppResult<Vec<String>> {
    Err(AppError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// In-memory stand-in for the Keychain: one map of account → item data.
    #[derive(Default)]
    struct MemoryBackend {
        items: Mutex<BTreeMap<String, String>>,
        reads: AtomicUsize,
        writes: AtomicUsize,
    }

    impl MemoryBackend {
        fn with(items: &[(&str, &str)]) -> Self {
            let backend = Self::default();
            {
                let mut map = backend.items.lock().unwrap();
                for (account, value) in items {
                    map.insert((*account).to_string(), (*value).to_string());
                }
            }
            backend
        }

        fn accounts(&self) -> Vec<String> {
            self.items.lock().unwrap().keys().cloned().collect()
        }

        fn data(&self, account: &str) -> Option<String> {
            self.items.lock().unwrap().get(account).cloned()
        }
    }

    impl ItemBackend for MemoryBackend {
        fn read(&self, account: &str) -> AppResult<Option<String>> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(self.items.lock().unwrap().get(account).cloned())
        }

        fn write(&self, account: &str, value: &str) -> AppResult<()> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            self.items
                .lock()
                .unwrap()
                .insert(account.to_string(), value.to_string());
            Ok(())
        }

        fn remove(&self, account: &str) -> AppResult<()> {
            self.items.lock().unwrap().remove(account);
            Ok(())
        }

        fn accounts_with_prefix(&self, prefix: &str) -> AppResult<Vec<String>> {
            Ok(self
                .items
                .lock()
                .unwrap()
                .keys()
                .filter(|account| account.starts_with(prefix))
                .cloned()
                .collect())
        }
    }

    fn tokens(count: usize) -> Vec<String> {
        (1..=count)
            .map(|index| format!("{TOKEN_ACCOUNT_PREFIX}connection-{index}"))
            .collect()
    }

    #[test]
    fn memory_store_round_trips_and_deletes() {
        let store = MemoryStore::default();
        store
            .set(ACCOUNT_SECRET_SANDBOX, &SecretString::new("s".into()))
            .unwrap();
        assert_eq!(
            store.get(ACCOUNT_SECRET_SANDBOX).unwrap().unwrap().expose(),
            "s"
        );
        store.delete(ACCOUNT_SECRET_SANDBOX).unwrap();
        assert!(store.get(ACCOUNT_SECRET_SANDBOX).unwrap().is_none());
    }

    #[test]
    fn memory_store_deletes_only_matching_prefixes() {
        let store = MemoryStore::default();
        for account in [ACCOUNT_SECRET_SANDBOX, ACCOUNT_CLIENT_ID_SANDBOX] {
            store.set(account, &SecretString::new("v".into())).unwrap();
        }
        store
            .set(
                &format!("{TOKEN_ACCOUNT_PREFIX}a"),
                &SecretString::new("t".into()),
            )
            .unwrap();
        assert_eq!(store.delete_prefix(TOKEN_ACCOUNT_PREFIX).unwrap(), 1);
        assert!(store.get(ACCOUNT_SECRET_SANDBOX).unwrap().is_some());
    }

    #[test]
    fn every_secret_lives_in_one_item() {
        let store = DocumentStore::new(MemoryBackend::default());
        store
            .set(
                ACCOUNT_CLIENT_ID_PRODUCTION,
                &SecretString::new("id".into()),
            )
            .unwrap();
        store
            .set(
                ACCOUNT_SECRET_PRODUCTION,
                &SecretString::new("secret".into()),
            )
            .unwrap();
        store
            .set(&tokens(1)[0], &SecretString::new("access".into()))
            .unwrap();

        assert_eq!(
            store.backend.accounts(),
            vec![CONSOLIDATED_ACCOUNT.to_string()],
            "three credentials, one Keychain item"
        );
        assert_eq!(
            store.get(&tokens(1)[0]).unwrap().unwrap().expose(),
            "access"
        );
        // The document is valid JSON with the expected version.
        let raw = store.backend.data(CONSOLIDATED_ACCOUNT).unwrap();
        assert!(raw.contains("\"v\":1"));
        assert_eq!(store.backend.writes.load(Ordering::SeqCst), 3);
    }

    #[test]
    fn a_new_connection_adds_no_item() {
        let store = DocumentStore::new(MemoryBackend::default());
        store
            .set(&tokens(1)[0], &SecretString::new("first".into()))
            .unwrap();
        let writes_before = store.backend.writes.load(Ordering::SeqCst);
        store
            .set(&tokens(2)[1], &SecretString::new("second".into()))
            .unwrap();

        assert_eq!(
            store.backend.accounts(),
            vec![CONSOLIDATED_ACCOUNT.to_string()]
        );
        assert_eq!(
            store.backend.writes.load(Ordering::SeqCst),
            writes_before + 1
        );
        assert_eq!(store.get(&tokens(2)[0]).unwrap().unwrap().expose(), "first");
        assert_eq!(
            store.get(&tokens(2)[1]).unwrap().unwrap().expose(),
            "second"
        );
    }

    #[test]
    fn removing_the_last_secret_removes_the_item() {
        let store = DocumentStore::new(MemoryBackend::default());
        store
            .set(
                ACCOUNT_CLIENT_ID_PRODUCTION,
                &SecretString::new("id".into()),
            )
            .unwrap();
        store.delete(ACCOUNT_CLIENT_ID_PRODUCTION).unwrap();
        assert!(store.backend.accounts().is_empty());
    }

    #[test]
    fn delete_prefix_keeps_client_credentials() {
        let store = DocumentStore::new(MemoryBackend::default());
        store
            .set(
                ACCOUNT_SECRET_PRODUCTION,
                &SecretString::new("secret".into()),
            )
            .unwrap();
        for account in tokens(2) {
            store
                .set(&account, &SecretString::new("token".into()))
                .unwrap();
        }
        assert_eq!(store.delete_prefix(TOKEN_ACCOUNT_PREFIX).unwrap(), 2);
        assert!(store.get(ACCOUNT_SECRET_PRODUCTION).unwrap().is_some());
        assert!(store.get(&tokens(2)[0]).unwrap().is_none());
    }

    #[test]
    fn legacy_items_are_migrated_into_the_document_and_deleted() {
        let backend = MemoryBackend::with(&[
            (ACCOUNT_CLIENT_ID_PRODUCTION, "id"),
            (ACCOUNT_SECRET_PRODUCTION, "secret"),
            ("plaid-access-token-existing", "access"),
            ("unrelated-item", "keep me"),
        ]);
        let store = DocumentStore::new(backend);

        assert_eq!(
            store
                .get(ACCOUNT_SECRET_PRODUCTION)
                .unwrap()
                .unwrap()
                .expose(),
            "secret"
        );
        // The document now carries all three secrets in one item...
        let raw = store.backend.data(CONSOLIDATED_ACCOUNT).unwrap();
        assert!(raw.contains("plaid-access-token-existing"));
        // ...the legacy items are gone, and nothing else was touched.
        assert_eq!(
            store.backend.accounts(),
            vec![
                CONSOLIDATED_ACCOUNT.to_string(),
                "unrelated-item".to_string()
            ]
        );
        assert_eq!(
            store
                .get("plaid-access-token-existing")
                .unwrap()
                .unwrap()
                .expose(),
            "access"
        );
    }

    #[test]
    fn migration_keeps_legacy_items_when_the_document_cannot_be_written() {
        struct ReadOnlyBackend(MemoryBackend);

        impl ItemBackend for ReadOnlyBackend {
            fn read(&self, account: &str) -> AppResult<Option<String>> {
                self.0.read(account)
            }
            fn write(&self, _account: &str, _value: &str) -> AppResult<()> {
                Err(AppError::Keychain)
            }
            fn remove(&self, account: &str) -> AppResult<()> {
                self.0.remove(account)
            }
            fn accounts_with_prefix(&self, prefix: &str) -> AppResult<Vec<String>> {
                self.0.accounts_with_prefix(prefix)
            }
        }

        let backend = MemoryBackend::with(&[
            (ACCOUNT_CLIENT_ID_PRODUCTION, "id"),
            (ACCOUNT_SECRET_PRODUCTION, "secret"),
        ]);
        let store = DocumentStore::new(ReadOnlyBackend(backend));
        // The write fails, so the load fails closed rather than deleting the
        // only copy of the credentials.
        assert!(store.get(ACCOUNT_SECRET_PRODUCTION).is_err());
    }

    #[test]
    fn a_malformed_document_fails_closed() {
        let backend = MemoryBackend::with(&[(CONSOLIDATED_ACCOUNT, "not json")]);
        let store = DocumentStore::new(backend);
        assert!(store.get(ACCOUNT_SECRET_PRODUCTION).is_err());

        let backend = MemoryBackend::with(&[(
            CONSOLIDATED_ACCOUNT,
            r#"{"v":99,"items":{"plaid-secret-production":"x"}}"#,
        )]);
        assert!(DocumentStore::new(backend)
            .get(ACCOUNT_SECRET_PRODUCTION)
            .is_err());

        let backend = MemoryBackend::with(&[(
            CONSOLIDATED_ACCOUNT,
            r#"{"v":1,"items":{"plaid-secret-production":""}}"#,
        )]);
        assert!(DocumentStore::new(backend)
            .get(ACCOUNT_SECRET_PRODUCTION)
            .is_err());
    }

    #[test]
    fn the_session_reads_the_item_once_and_a_lock_drops_it() {
        let backend = MemoryBackend::with(&[(ACCOUNT_CLIENT_ID_PRODUCTION, "id")]);
        let store = DocumentStore::new(backend);
        assert!(store.get(ACCOUNT_CLIENT_ID_PRODUCTION).unwrap().is_some());
        // Migration is the only multi-read path (the consolidated probe plus one
        // read per legacy account); everything after it is served from memory.
        let after_load = store.backend.reads.load(Ordering::SeqCst);
        for _ in 0..5 {
            assert!(store.get(ACCOUNT_CLIENT_ID_PRODUCTION).unwrap().is_some());
        }
        assert_eq!(store.backend.reads.load(Ordering::SeqCst), after_load);

        store.clear_cache();
        store.get(ACCOUNT_CLIENT_ID_PRODUCTION).unwrap();
        assert!(store.backend.reads.load(Ordering::SeqCst) > after_load);
    }
}
