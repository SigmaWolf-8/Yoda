-- Email is case-insensitive in practice: nobody recalls how they capitalized
-- their own address, and an account created as Someone@Example.com must open
-- when its owner types someone@example.com.
--
-- Every lookup now compares on lower(email). This index keeps those lookups on
-- an index scan rather than a sequential one, and — being unique — makes it
-- impossible to create two accounts that differ only by case, which would
-- leave the login query picking one of them arbitrarily.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
    ON users (lower(email));
