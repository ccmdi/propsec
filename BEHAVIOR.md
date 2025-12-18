  Before:
  - required + null was effectively the same as not required because both "key missing" and "key present but null" were treated identically

  After:
  - required = the key MUST exist in frontmatter
  - null (allowEmpty) = if the key exists, it can have a null/empty value

  New behavior matrix:

  | required | null  | Key missing | Key with value | Key with null |
  |----------|-------|-------------|----------------|---------------|
  | false    | false | OK          | validates type | ERROR         |
  | false    | true  | OK          | validates type | OK            |
  | true     | false | ERROR       | validates type | ERROR         |
  | true     | true  | ERROR       | validates type | OK            |

  So now required + null means "key must be present, but can be null" - exactly what you wanted.

  required controls **key** presence, null controls whether null is a valid **value**. Orthogonal concerns.