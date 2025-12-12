# PhishCatch Setup

1. `make setup`

2. `make start`

3. Go to `brave://extensions/`

4. Enable **Developer mode** (top right)

5. Click **PhishCatch extension** icon

6. Click **Debug** tab

7. Paste config and click **Save**:

```json
{
  "data_expiry": 30,
  "display_reuse_alerts": true,
  "enable_debug_gui": true,
  "enterprise_domains": ["practicetestautomation.com"],
  "expire_hash_on_use": false,
  "ignored_domains": [],
  "manual_password_entry": false,
  "pbkdf2_iterations": 100000,
  "phishcatch_server": "http://localhost:8000",
  "psk": "phishcatch-secret-key-2024",
  "url_sanitization_level": "host",
  "username_regexes": [],
  "username_selectors": [],
  "banned_urls": []
}
```

8. Go to `brave://extensions/` → click **refresh** on PhishCatch

9. Go to `https://practicetestautomation.com/practice-test-login/` → enter `student` / `Password123` → click outside password field → click **Submit**

10. Go to `https://chatgpt.com` → type `Password123` → press **Enter**

11. See **alert notification** for password leak!
