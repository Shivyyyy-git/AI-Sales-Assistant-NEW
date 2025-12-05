# 🔒 Password Protection Setup

## Local Development

The password is stored in `frontend/.env` which is **NOT tracked by Git**.

## Render Deployment Instructions

⚠️ **IMPORTANT:** You must set the password as an environment variable in Render.

### Steps:

1. Go to your Render dashboard
2. Select your service (AI Sales Assistant)
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   - **Key:** `VITE_APP_PASSWORD`
   - **Value:** `your_secure_password_here`
6. Click **Save Changes**
7. Render will automatically redeploy with the password protection

### Security Notes:

✅ Password is **NOT** in GitHub  
✅ Password is **NOT** in any committed files  
✅ Only stored in:
  - Local: `frontend/.env` (ignored by Git)
  - Render: Environment Variables (encrypted)

### Changing the Password:

**Local:**
- Edit `frontend/.env`
- Change `VITE_APP_PASSWORD=NewPassword`

**Render:**
- Go to Environment tab
- Update `VITE_APP_PASSWORD` value
- Save (auto-redeploys)

---

**Contact for Access:**
- LinkedIn: https://www.linkedin.com/in/shivamsharma-ai/
- Website: https://www.shivam.website/

