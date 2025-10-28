# app/routes/__init__.py
from .base_routes import base_bp
from .preview_routes import preview_bp
from .download_routes import download_bp
from .audio_routes import audio_bp

def register_routes(app):
    app.register_blueprint(base_bp)
    app.register_blueprint(preview_bp)
    app.register_blueprint(download_bp)
    app.register_blueprint(audio_bp)
