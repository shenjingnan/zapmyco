__version__ = "0.1.0"
__author__ = "shenjingnan"
__all__ = ["useful_function", "UsefulClass"]

from .utils import useful_function
from .services import UsefulClass

import logging

logging.getLogger(__name__).addHandler(logging.NullHandler())

DEFAULT_TIMEOUT = 30
