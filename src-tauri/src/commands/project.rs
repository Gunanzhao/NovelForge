//! Project-level command boundary.
//!
//! Implementations are kept in the compatibility module during the staged
//! migration; this facade gives callers a stable domain namespace.
#[allow(unused_imports)]
pub(crate) use super::{create_project, list_documents, open_project, update_project};
