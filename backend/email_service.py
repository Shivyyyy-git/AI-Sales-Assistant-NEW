"""
Email Notification Service
Sends formatted emails to team members when client intake is submitted
"""
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()


class EmailService:
    """Simple email service using SMTP"""
    
    def __init__(self):
        self.smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        self.smtp_port = int(os.getenv('SMTP_PORT', '587'))
        self.smtp_user = os.getenv('SMTP_USER', '')
        self.smtp_password = os.getenv('SMTP_PASSWORD', '')
        self.from_email = os.getenv('FROM_EMAIL', self.smtp_user)
        self.to_emails = [email.strip() for email in os.getenv('TEAM_EMAILS', '').split(',') if email.strip()]
        
    def can_send(self) -> bool:
        """Check if email is configured"""
        return bool(self.smtp_user and self.smtp_password and self.to_emails)
    
    def send_intake_notification(
        self,
        transcript: str,
        client_info: Dict[str, Any],
        recommendations: List[Dict[str, Any]],
        summary: Dict[str, Any]
    ) -> bool:
        """
        Send email notification to team about new client intake
        
        Args:
            transcript: Full conversation transcript
            client_info: Extracted client information
            recommendations: Ranked community recommendations
            summary: AI-generated summary
            
        Returns:
            True if email sent successfully, False otherwise
        """
        if not self.can_send():
            print("[EMAIL] Email not configured. Set SMTP_USER, SMTP_PASSWORD, and TEAM_EMAILS environment variables.")
            return False
        
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = f"New Client Intake: {client_info.get('name', 'Unknown Client')}"
            msg['From'] = self.from_email
            msg['To'] = ', '.join(self.to_emails)
            
            # Build email content
            text_content = self._build_text_email(transcript, client_info, recommendations, summary)
            html_content = self._build_html_email(transcript, client_info, recommendations, summary)
            
            # Attach both versions
            msg.attach(MIMEText(text_content, 'plain'))
            msg.attach(MIMEText(html_content, 'html'))
            
            # Send email
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)
            
            print(f"[EMAIL] Successfully sent intake notification to {len(self.to_emails)} recipient(s)")
            return True
            
        except Exception as e:
            print(f"[EMAIL] Failed to send email: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def _build_text_email(
        self,
        transcript: str,
        client_info: Dict[str, Any],
        recommendations: List[Dict[str, Any]],
        summary: Dict[str, Any]
    ) -> str:
        """Build plain text email"""
        lines = [
            "=" * 80,
            "NEW CLIENT INTAKE SUBMISSION",
            "=" * 80,
            "",
            "CLIENT INFORMATION:",
            "-" * 40,
        ]
        
        # Client info
        for key, value in client_info.items():
            if value:
                key_display = key.replace('_', ' ').title()
                lines.append(f"{key_display}: {value}")
        
        lines.extend([
            "",
            "=" * 80,
            "FULL TRANSCRIPT",
            "=" * 80,
            transcript,
            "",
            "=" * 80,
            "AI SUMMARY",
            "=" * 80,
        ])
        
        if summary:
            for key, value in summary.items():
                if value:
                    key_display = key.replace('_', ' ').title()
                    lines.append(f"{key_display}: {value}")
        
        lines.extend([
            "",
            "=" * 80,
            "RECOMMENDED COMMUNITIES",
            "=" * 80,
        ])
        
        if recommendations:
            for idx, rec in enumerate(recommendations[:10], 1):  # Top 10
                lines.extend([
                    f"\n{idx}. {rec.get('name', 'Unknown Community')}",
                    f"   Rank Score: {rec.get('final_rank', 'N/A')}",
                    f"   Price: ${rec.get('key_metrics', {}).get('monthly_fee', 0):,}/month" if rec.get('key_metrics', {}).get('monthly_fee') else "   Price: Not specified",
                    f"   Location: {rec.get('key_metrics', {}).get('zip_code', 'N/A')}",
                    f"   Care Level: {rec.get('key_metrics', {}).get('care_level', 'N/A')}",
                    f"   Reason: {rec.get('explanations', {}).get('holistic_reason', 'N/A')[:100]}...",
                ])
        else:
            lines.append("No recommendations generated.")
        
        lines.extend([
            "",
            "=" * 80,
            "NEXT STEPS",
            "=" * 80,
            "Please contact the client within 24 hours to:",
            "1. Confirm all information is correct",
            "2. Explain the recommended options",
            "3. Schedule tours of communities that interest them",
            "",
        ])
        
        return "\n".join(lines)
    
    def _build_html_email(
        self,
        transcript: str,
        client_info: Dict[str, Any],
        recommendations: List[Dict[str, Any]],
        summary: Dict[str, Any]
    ) -> str:
        """Build HTML email"""
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 800px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                .section { background: #f8f9fa; padding: 15px; margin: 20px 0; border-radius: 8px; border-left: 4px solid #667eea; }
                .section h2 { margin-top: 0; color: #667eea; }
                .info-row { padding: 8px 0; border-bottom: 1px solid #e0e0e0; }
                .info-row:last-child { border-bottom: none; }
                .info-label { font-weight: bold; color: #555; }
                .transcript { background: white; padding: 15px; border-radius: 8px; white-space: pre-wrap; font-family: monospace; font-size: 12px; max-height: 400px; overflow-y: auto; }
                .recommendation { background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid #10b981; }
                .recommendation h3 { margin-top: 0; color: #10b981; }
                .rank-badge { display: inline-block; background: #667eea; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
                .next-steps { background: #e0f2fe; padding: 15px; border-radius: 8px; border-left: 4px solid #0ea5e9; }
                .next-steps h3 { margin-top: 0; color: #0ea5e9; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🎯 New Client Intake Submission</h1>
                    <p>A new client has submitted their information. Please review and contact them within 24 hours.</p>
                </div>
        """
        
        # Client Information
        html += '<div class="section"><h2>👤 Client Information</h2>'
        for key, value in client_info.items():
            if value:
                key_display = key.replace('_', ' ').title()
                html += f'<div class="info-row"><span class="info-label">{key_display}:</span> {value}</div>'
        html += '</div>'
        
        # Transcript
        html += f'''
        <div class="section">
            <h2>📝 Full Transcript</h2>
            <div class="transcript">{transcript[:5000]}{'... (truncated)' if len(transcript) > 5000 else ''}</div>
        </div>
        '''
        
        # Summary
        if summary:
            html += '<div class="section"><h2>🤖 AI Summary</h2>'
            for key, value in summary.items():
                if value:
                    key_display = key.replace('_', ' ').title()
                    html += f'<div class="info-row"><span class="info-label">{key_display}:</span> {value}</div>'
            html += '</div>'
        
        # Recommendations
        html += '<div class="section"><h2>🏠 Recommended Communities</h2>'
        if recommendations:
            for idx, rec in enumerate(recommendations[:10], 1):
                name = rec.get('name', 'Unknown Community')
                rank = rec.get('final_rank', 'N/A')
                metrics = rec.get('key_metrics', {})
                price = metrics.get('monthly_fee', 0)
                location = metrics.get('zip_code', 'N/A')
                care_level = metrics.get('care_level', 'N/A')
                reason = rec.get('explanations', {}).get('holistic_reason', 'N/A')
                
                html += f'''
                <div class="recommendation">
                    <h3>#{idx} {name} <span class="rank-badge">Rank {rank}</span></h3>
                    <p><strong>Price:</strong> ${price:,}/month</p>
                    <p><strong>Location:</strong> ZIP {location}</p>
                    <p><strong>Care Level:</strong> {care_level}</p>
                    <p><strong>Why this fits:</strong> {reason[:200]}...</p>
                </div>
                '''
        else:
            html += '<p>No recommendations generated.</p>'
        html += '</div>'
        
        # Next Steps
        html += '''
        <div class="next-steps">
            <h3>✅ Next Steps</h3>
            <ol>
                <li>Contact the client within 24 hours</li>
                <li>Confirm all information is correct</li>
                <li>Explain the recommended options</li>
                <li>Schedule tours of communities that interest them</li>
            </ol>
        </div>
        
            </div>
        </body>
        </html>
        '''
        
        return html


# Singleton instance
_email_service = None

def get_email_service() -> EmailService:
    """Get or create email service instance"""
    global _email_service
    if _email_service is None:
        _email_service = EmailService()
    return _email_service
