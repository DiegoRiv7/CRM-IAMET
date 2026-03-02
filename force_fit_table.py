import os

file_path = '/Users/diegorivera7/Downloads/proyecto/Gesti-n-de-ventas/app/templates/crm_home.html'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update CSS: Remove overflow-x: auto from .crm-table-wrap
content = content.replace('overflow-x: auto;', 'overflow: hidden;')

# 2. Add extra CSS to handle tight fitting
tight_css = """
    .crm-table th, .crm-table td {
        padding-left: 4px !important;
        padding-right: 4px !important;
        white-space: nowrap;
    }
    .crm-table td div {
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 130px;
    }
    /* Ensure the table collapses as much as possible */
    table {
        table-layout: auto;
        width: 100% !important;
    }
"""

# Find a good place to inject CSS - before </style>
content = content.replace('</style>', tight_css + '\n</style>')

# 3. Double check the HTML wrappers
content = content.replace('overflow-x-auto', 'overflow-hidden')

# 4. Remove any explicit min-widths that are too large
content = content.replace('min-width: 140px;', 'max-width: 140px;')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("CSS and HTML updated to force table to fit screen.")
