# Admin table reference (documentation only)

This file documents a proposed `admins` table. **No table, migration, user account, or database row has been created.**

## Proposed DDL as supplied

```sql
CREATE TABLE admins (
  admin_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

## Compatibility with the current MerchantHub schema

The current application schema defines the users primary key as signed `users.id` (not `users.user_id`). Consequently, the supplied foreign key cannot be applied to the current database as written. A version compatible with the current `users` table would use a signed `user_id` column referencing `users.id`:

```sql
CREATE TABLE `admins` (
  `admin_id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL UNIQUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `admins_user_id_fk`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
```

## Example relationship (not an inserted row)

| admins.admin_id | admins.user_id | Related user email | Role |
|---:|---:|---|---|
| 1 (example only) | `<the users.id for admin@gmail.com>` | `admin@gmail.com` | `admin` |

The `admins` table is intended to hold the relationship to a user, not login credentials. Email, role, and password-hash data belong in `users`. The password supplied for the example account is intentionally **not** recorded here or stored as plaintext. If an administrator account is provisioned later, the application should store only its normal password hash in `users.passwordHash` and link its `users.id` from `admins.user_id`.

```mermaid
erDiagram
  users ||--o| admins : "optional admin membership"
  users {
    INT id PK
    VARCHAR email
    ENUM role
  }
  admins {
    INT UNSIGNED admin_id PK
    INT user_id FK
    TIMESTAMP created_at
  }
```

### Example link statement (documentation only)

After the compatible table exists and an administrator user has already been created through the application, the relationship could be added with:

```sql
INSERT INTO `admins` (`user_id`)
SELECT `id` FROM `users`
WHERE `email` = 'admin@gmail.com' AND `role` = 'admin';
```

This statement intentionally does not insert a password. It links the admin record to a user row whose application-managed credential is stored as a password hash.
