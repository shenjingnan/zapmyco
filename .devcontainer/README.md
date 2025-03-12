# DevContainer Testing Guide

This directory contains configuration files and scripts for building and testing the development container (DevContainer).

## File Structure

- `devcontainer.json` - VS Code DevContainer configuration file
- `Dockerfile` - Docker configuration for building the development container
- `post_create.sh` - User-level environment setup script executed after container creation
- `setup_mirrors.sh` - Script for configuring mirror sources (suitable for mainland China network environment)
- `test_devcontainer.sh` - Script for validating the DevContainer environment
- `.env` / `.env.cn` - Environment variable configuration files

## Automated Testing

We use GitHub Actions to automatically test the DevContainer build and functionality. The test workflow is defined in the `.github/workflows/devcontainer-test.yml` file.

The test workflow is triggered in the following cases:
- When changes to files in the `.devcontainer` directory are pushed to the `main` branch
- When a Pull Request containing changes to the `.devcontainer` directory is created
- When the workflow is manually triggered

## Local Testing

You can test the DevContainer build and functionality locally:

### Building the DevContainer Image

```bash
cd /path/to/your/project
docker build -t devcontainer-test -f .devcontainer/Dockerfile .
```

### Running the Test Script

```bash
# Ensure the test script is executable
chmod +x .devcontainer/test_devcontainer.sh

# Run the test script in the container
docker run --rm -v $(pwd):/workspace devcontainer-test bash -c "cd /workspace && .devcontainer/test_devcontainer.sh"
```

### Testing the post_create.sh Script

```bash
# Create a temporary directory to simulate the workspace
mkdir -p /tmp/workspace
cp -r .devcontainer /tmp/workspace/
cp -r package.json /tmp/workspace/ # if exists
cp -r .nvmrc /tmp/workspace/ # if exists

# Run the post_create.sh script in the container
docker run --rm -v /tmp/workspace:/workspace devcontainer-test bash -c "cd /workspace && chmod +x .devcontainer/post_create.sh && .devcontainer/post_create.sh"
```

## Troubleshooting Common Issues

### 1. NVM or Node.js Not Available

Check if the NVM configuration in the `post_create.sh` script is correct, especially the `NVM_DIR` environment variable setting.

### 2. Python Virtual Environment Issues

Ensure that the `VIRTUAL_ENV` path is correctly set in the `post_create.sh` script, and that the script has permission to create and activate the virtual environment.

### 3. Mirror Source Configuration Issues

If you encounter download problems in mainland China network environment, check the mirror source configuration in the `.env.cn` file and ensure the `setup_mirrors.sh` script is executed correctly.

## Custom Testing

You can modify the `test_devcontainer.sh` script according to project requirements to add more test items. For example:

- Testing if specific project dependencies are available
- Verifying if specific development tools are correctly configured
- Checking database connections, etc.

## Contribution Guidelines

If you have suggestions for improving the DevContainer configuration, please:

1. Fork this repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

Please ensure your changes have passed the DevContainer test workflow before submitting a PR. 