# Smart Home System Backend

This is the backend service for the Smart Home System project. It provides APIs and services for managing smart home devices and automation.

## Installation

```bash
# Install Poetry (if not already installed)
curl -sSL https://install.python-poetry.org | python3 -

# Install dependencies
poetry install

# Install with development dependencies
poetry install --with dev

# Install with test dependencies
poetry install --with test

# Install with both development and test dependencies
poetry install --with dev,test
```

## Features

- Device management
- Automation rules
- API endpoints for frontend integration

## Development

This project uses Poetry for dependency management with dependencies defined in `pyproject.toml`.

To run the application:

```bash
# Using Poetry
poetry run python main.py

# Or with the defined script
poetry run server

# Or with uvicorn directly
poetry run uvicorn main:app --reload
```

## Testing

```bash
# Run tests
poetry run pytest

# Run tests with coverage
poetry run pytest --cov=.
```

## Code Quality

```bash
# Format code with black
poetry run black .

# Sort imports with isort
poetry run isort .

# Lint code with flake8
poetry run flake8 .

# Type check with mypy
poetry run mypy .
``` 