"""Gen-ZSplit group module.  Wire it up with ``groupsplit.init_app(app)``."""
from flask import Flask

from db import close_db

from . import filters
from .routes import bp
from .security import csrf_token


def init_app(app: Flask) -> None:
    app.teardown_appcontext(close_db)
    app.jinja_env.globals["csrf_token"] = csrf_token
    filters.register(app)
    app.register_blueprint(bp)
