import re

path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm/_scripts_mail.html'
with open(path, 'r', encoding='utf-8') as f:
    text = f.read()

# Replace all inline comments that start with '// ' into '/* ... */'
# Carefully doing this for the known ones since it's one single line.
# Known comments:
# // { id, asunto, remitente_email, remitente_nombre }
# // Remove blockquotes (quoted thread content)
# // Remove common email-client quote/signature containers
# // Scan line-by-line to find where the actual message ends
# // Quoted lines (start with >)
# // Standard RFC signature delimiter
# // Common closing salutation words on a short standalone line
# // Catches: "Regards", "Saludos", "Regards / Saludos", "Best regards,", "Atentamente", etc.
# // Also cut at multi-line thread separator patterns
# // Generic file → download
# // Body
# // Pre-fill widgetNegociacion fields
# // Opportunity title = email subject
# // Client = company extracted from sender domain
# // Contact = sender's name
# // Comments = cleaned body text (first 800 chars) — goes to conversación
# // Elevate widgetNegociacion above mail widget
# // Open it
# // Inline thumbnail in preview strip
# // PDF chip → opens embedded viewer
# // PDF embed toggle in preview strip
# // Mark as read in UI
# // Body stored in module vars — used by mailAbrirFormNuevaOpp()
# // Handle compound TLDs: com.mx, org.mx, gob.mx, edu.mx etc.
# // Remove [cid:...] references (appear literally in plain-text email versions)
# // already running
# // New emails on server — trigger silent full sync
# // Widget open — refresh list and show toast
# // Widget closed — show badge on nav button
# // every 2 minutes

# We will just write a regex that finds "// [text up to end of line or next js delimiter]"
# But wait, it's one single string! All the comments actually swallow the REST of the code.

text = text.replace('// { id, asunto, remitente_email, remitente_nombre }', '/* { id, asunto, remitente_email, remitente_nombre } */')
text = text.replace('// Remove blockquotes (quoted thread content)', '/* Remove blockquotes (quoted thread content) */')
text = text.replace('// Remove common email-client quote/signature containers', '/* Remove common email-client quote/signature containers */')
text = text.replace('// Scan line-by-line to find where the actual message ends', '/* Scan line-by-line to find where the actual message ends */')
text = text.replace('// Quoted lines (start with >)', '/* Quoted lines (start with >) */')
text = text.replace('// Standard RFC signature delimiter', '/* Standard RFC signature delimiter */')
text = text.replace('// Common closing salutation words on a short standalone line', '/* Common closing salutation words on a short standalone line */')
text = text.replace('// Catches: "Regards", "Saludos", "Regards / Saludos", "Best regards,", "Atentamente", etc.', '/* Catches: "Regards", "Saludos", "Regards / Saludos", "Best regards,", "Atentamente", etc. */')
text = text.replace('// Also cut at multi-line thread separator patterns', '/* Also cut at multi-line thread separator patterns */')
text = text.replace('// Generic file → download', '/* Generic file → download */')
text = text.replace('// Body', '/* Body */')
text = text.replace('// Pre-fill widgetNegociacion fields', '/* Pre-fill widgetNegociacion fields */')
text = text.replace('// Opportunity title = email subject', '/* Opportunity title = email subject */')
text = text.replace('// Client = company extracted from sender domain', '/* Client = company extracted from sender domain */')
text = text.replace('// Contact = sender\'s name', '/* Contact = sender\'s name */')
text = text.replace('// Comments = cleaned body text (first 800 chars) — goes to conversación', '/* Comments = cleaned body text (first 800 chars) — goes to conversación */')
text = text.replace('// Elevate widgetNegociacion above mail widget', '/* Elevate widgetNegociacion above mail widget */')
text = text.replace('// Open it', '/* Open it */')
text = text.replace('// Inline thumbnail in preview strip', '/* Inline thumbnail in preview strip */')
text = text.replace('// PDF chip → opens embedded viewer', '/* PDF chip → opens embedded viewer */')
text = text.replace('// PDF embed toggle in preview strip', '/* PDF embed toggle in preview strip */')
text = text.replace('// Mark as read in UI', '/* Mark as read in UI */')
text = text.replace('// Body stored in module vars — used by mailAbrirFormNuevaOpp()', '/* Body stored in module vars — used by mailAbrirFormNuevaOpp() */')
text = text.replace('// Handle compound TLDs: com.mx, org.mx, gob.mx, edu.mx etc.', '/* Handle compound TLDs: com.mx, org.mx, gob.mx, edu.mx etc. */')
text = text.replace('// Remove [cid:...] references (appear literally in plain-text email versions)', '/* Remove [cid:...] references (appear literally in plain-text email versions) */')
text = text.replace('// already running', '/* already running */')
text = text.replace('// New emails on server — trigger silent full sync', '/* New emails on server — trigger silent full sync */')
text = text.replace('// Widget open — refresh list and show toast', '/* Widget open — refresh list and show toast */')
text = text.replace('// Widget closed — show badge on nav button', '/* Widget closed — show badge on nav button */')
text = text.replace('// every 2 minutes', '/* every 2 minutes */')

# also catch the main header comment
text = text.replace('// ══════════════════════════════════════════════ WIDGET MAIL ══════════════════════════════════════════════', '/* ══════════════════════════════════════════════ WIDGET MAIL ══════════════════════════════════════════════ */')

with open(path, 'w', encoding='utf-8') as f:
    f.write(text)

print('Fixed comments in _scripts_mail.html')
