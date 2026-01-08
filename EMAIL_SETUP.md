# Email Notification Setup

The client intake system sends email notifications to your team when a client submits their information.

## Environment Variables

Add these to your backend environment variables (Render dashboard):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
FROM_EMAIL=your-email@gmail.com
TEAM_EMAILS=neil@example.com,assistant@example.com
```

## Gmail Setup (Recommended)

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate App Password**:
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Enter "AI Sales Assistant"
   - Copy the 16-character password
3. **Use App Password** as `SMTP_PASSWORD` (not your regular Gmail password)

## Other Email Providers

### Outlook/Office 365
```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASSWORD=your-password
```

### SendGrid
```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
FROM_EMAIL=your-verified-sender@example.com
```

### Custom SMTP
Use any SMTP provider with:
- `SMTP_HOST`: Your SMTP server
- `SMTP_PORT`: Usually 587 (TLS) or 465 (SSL)
- `SMTP_USER`: Your SMTP username
- `SMTP_PASSWORD`: Your SMTP password

## Email Content

The email includes:
- **Client Information**: Name, budget, location, care level, timeline
- **Full Transcript**: Complete conversation/input text
- **AI Summary**: Structured summary of key points
- **Recommended Communities**: Top 10 ranked options with:
  - Community name and rank
  - Monthly price
  - Location (ZIP code)
  - Care level offered
  - Why it fits the client
- **Next Steps**: Reminder to contact client within 24 hours

## Testing

To test email functionality, submit a test intake via:
- Frontend: `yoursite.com/#/client`
- Or use the `/api/process-client-intake` endpoint directly

Check backend logs for email status messages.

## Troubleshooting

**Email not sending?**
- Check SMTP credentials are correct
- Verify `TEAM_EMAILS` is set (comma-separated)
- Check backend logs for error messages
- For Gmail, ensure app password is used (not regular password)

**Email going to spam?**
- Consider using a verified sender domain (SendGrid, etc.)
- Add sender to contacts
- Check spam folder
