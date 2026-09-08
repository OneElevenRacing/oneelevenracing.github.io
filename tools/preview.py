#!/usr/bin/env python3
"""Serve the actual pages with isolated sample data, never the live database."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
PAGES = {'main.html', 'championship.html', 'admin.html', 'poll.html'}


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        # Sample pages cannot connect to Firebase or any other service.
        self.send_header('Content-Security-Policy', "connect-src 'none'; form-action 'none'")
        super().end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/':
            page = (ROOT / 'tools/preview.html').read_text()
        elif path.lstrip('/') in PAGES:
            page = (ROOT / path.lstrip('/')).read_text()
            page = re.sub(r'<script\s+src="https://www.gstatic.com/firebasejs/[^\"]+"\s*></script>', '', page)
            page = page.replace('<head>', '<head>\n<script src="/tools/preview-data.js"></script>', 1)
        else:
            file = Path(self.translate_path(path)).resolve()
            allowed_tools = {ROOT / 'tools/preview-data.js'}
            if (not file.is_relative_to(ROOT) or any(part.startswith('.') for part in file.relative_to(ROOT).parts)
                    or not file.is_file() or file.suffix.lower() not in {'.js', '.css', '.png', '.jpg', '.jpeg', '.ico', '.ttf'}
                    or (file.is_relative_to(ROOT / 'tools') and file not in allowed_tools)):
                self.send_error(404, 'This page is not part of the sample preview.')
                return
            return super().do_GET()
        data = page.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8000), partial(PreviewHandler, directory=str(ROOT)))
    print('Local sample preview: http://127.0.0.1:8000/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
