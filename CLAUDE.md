# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Django-based sales management system ("Gestión de Ventas") designed to manage sales opportunities, clients, quotations, and Bitrix24 CRM integration. The application allows users to track sales opportunities, create quotations/estimates, and manage customer relationships with PDF generation capabilities.

## Technology Stack

- **Backend**: Django 5.2.4 with Python 3.13
- **Database**: SQLite (development) / MySQL 8.0 (production)
- **Frontend**: Django templates with Bootstrap/HTML/CSS/JavaScript
- **PDF Generation**: WeasyPrint for quotation PDFs
- **External Integration**: Bitrix24 CRM via webhooks
- **Containerization**: Docker with Docker Compose
- **Web Server**: Gunicorn (production)

## Development Commands

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Run migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser

# Collect static files
python manage.py collectstatic

# Run development server
python manage.py runserver

# Run specific management commands
python manage.py sync_bitrix
python manage.py sync_bitrix_contacts
```

### Docker Development
```bash
# Build and run with Docker Compose
docker-compose up --build

# Run migrations in container
docker-compose exec web python manage.py migrate

# Access container shell
docker-compose exec web bash
```

### Production Deployment
```bash
# Build production image
docker build -t sales-management .

# Run with Gunicorn (via entrypoint.sh)
gunicorn cartera_clientes.wsgi:application --bind 0.0.0.0:8000
```

## Application Architecture

### Django Project Structure
- **cartera_clientes/**: Main Django project directory containing settings and root URLs
- **app/**: Main application containing all business logic
  - `models.py`: Core data models (TodoItem, Cliente, Cotizacion, etc.)
  - `views.py`: Main view functions for web interface
  - `views_exportar.py`: Export functionality
  - `bitrix_integration.py`: Bitrix24 CRM integration
  - `forms.py`: Django forms for data input
  - `templates/`: HTML templates
  - `static/`: CSS and JavaScript assets
  - `management/commands/`: Custom Django management commands

### Core Models
- **TodoItem**: Represents sales opportunities with stages, probability, amounts
- **Cliente**: Customer/company information with Bitrix24 integration
- **Contacto**: Customer contacts linked to companies
- **Cotizacion**: Quotations/estimates with line items
- **DetalleCotizacion**: Individual line items within quotations
- **UserProfile**: Extended user profile with Bitrix24 user mapping

### Key Features
- **Sales Opportunity Management**: Track deals through sales pipeline with probability and closure dates
- **Customer Management**: Maintain customer database with Bitrix24 synchronization
- **Quotation System**: Create detailed quotes with PDF export (supporting both Bajanet and Iamet templates)
- **Dashboard Analytics**: Visual reporting of sales metrics by month, product, user
- **Role-Based Access**: Supervisor vs regular user permissions
- **Bitrix24 Integration**: Bidirectional sync of companies, contacts, and deals

### URL Structure
- `/app/`: Main application routes
- `/app/dashboard/`: Sales analytics and reporting
- `/app/todos/`: Sales opportunities listing
- `/app/cotizaciones/`: Quotation management
- `/admin/`: Django admin interface
- API endpoints under `/app/api/` for AJAX functionality

### Environment Configuration
The application uses environment variables for configuration:
- `DJANGO_SECRET_KEY`: Django secret key
- `DJANGO_DEBUG`: Debug mode flag
- `DJANGO_ALLOWED_HOSTS`: Allowed hosts for deployment
- `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`: Database configuration
- `BITRIX_WEBHOOK_URL`: Bitrix24 integration webhook URL

### Database Notes
- Uses SQLite for development (automatic fallback)
- Configured for MySQL in production when environment variables are set
- Includes extensive migrations history in `app/migrations/`
- Models support both Spanish language interface and Bitrix24 field mapping

### Static Files
- Admin customizations in `app/static/admin_custom/`
- Custom CSS for specific views (e.g., `oportunidad_detail.css`)
- Static files collected to `staticfiles/` directory for production

### Authentication & Authorization
- Standard Django authentication with custom login/logout views
- User groups for role-based permissions (Supervisores group)
- Login redirects to `/app/todos/` after authentication
- Context processor for supervisor status checking