PRAGMA foreign_keys = ON;

-- 0006_legal_document_support_email.sql
--
-- Adds an explicit support/privacy contact to versioned legal-document records.
-- This keeps the D1 audit ledger aligned with the Google Play support contact
-- and the public Privacy Policy without rewriting historical migration 0005.

ALTER TABLE legal_documents ADD COLUMN support_email TEXT;

UPDATE legal_documents
SET support_email = 'voxyl.app@gmail.com',
    updated_at = CURRENT_TIMESTAMP
WHERE document_type = 'privacy_policy'
  AND version = '2026-08-29'
  AND locale IN ('en-US', 'pt-BR');
