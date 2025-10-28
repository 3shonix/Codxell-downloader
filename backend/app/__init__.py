# app/__init__.py
import logging
import os
from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO

# create socketio instance with enhanced options
socketio = SocketIO(
    cors_allowed_origins="*", 
    async_mode="threading",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    manage_session=False  # Important for threading mode
)

def create_app():
    app = Flask(__name__)
    CORS(app, resources={r"/*": {"origins": "*"}})

    # basic logging
    logging.basicConfig(level=logging.INFO)

    # ensure downloads dir exists
    try:
        from .config import DOWNLOADS_DIR
        os.makedirs(DOWNLOADS_DIR, exist_ok=True)
    except Exception:
        pass

    # register blueprints/routes
    from .routes import register_routes
    register_routes(app)

    from .utils import register_socket_handlers
    register_socket_handlers(app)

    # IMPORTANT: bind socketio to app before returning
    socketio.init_app(
        app, 
        cors_allowed_origins="*", 
        async_mode="threading",
        logger=False,
        engineio_logger=False,
        ping_timeout=60,
        ping_interval=25,
        manage_session=False
    )

    return app