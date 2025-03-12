#!/bin/bash
# test_devcontainer.sh - Script for validating the DevContainer environment

# Enable error tracking and pipeline error detection
set -eo pipefail

# Colored output functions
log_info() {
  echo -e "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
  echo -e "\033[0;32m[SUCCESS]\033[0m $1"
}

log_warning() {
  echo -e "\033[0;33m[WARNING]\033[0m $1" >&2
}

log_error() {
  echo -e "\033[0;31m[ERROR]\033[0m $1" >&2
}

# Error handling function
handle_error() {
  log_error "Error on line $1, exit code: $2"
  exit $2
}

# Set error handling trap
trap 'handle_error ${LINENO} $?' ERR

# Display test start information
log_info "===== DevContainer Environment Test Started ====="
log_info "Current working directory: $(pwd)"
log_info "Current user: $(whoami)"
log_info "System information: $(uname -a)"

# Test basic system tools
log_info "Testing basic system tools..."
TOOLS=("git" "curl" "bash" "python" "pip")
for tool in "${TOOLS[@]}"; do
  if command -v $tool &> /dev/null; then
    log_success "$tool available: $($tool --version 2>&1 | head -n 1)"
  else
    log_error "$tool not available"
    exit 1
  fi
done

# Test Python environment
log_info "Testing Python environment..."
if command -v python &> /dev/null; then
  log_success "Python version: $(python --version)"
  
  # Test pip
  if command -v pip &> /dev/null; then
    log_success "pip available: $(pip --version)"
  else
    log_error "pip not available"
    exit 1
  fi
  
  # Test uv
  if command -v uv &> /dev/null; then
    log_success "uv available: $(uv --version)"
  else
    log_warning "uv not available, this may affect dependency management"
  fi
  
  # Test Python virtual environment
  log_info "Testing Python virtual environment..."
  VENV_PATH="$HOME/.local/project-venv"
  if [ -d "$VENV_PATH" ]; then
    log_success "Python virtual environment exists: $VENV_PATH"
    if [ -f "$VENV_PATH/bin/activate" ]; then
      log_success "Virtual environment activation script exists"
      source "$VENV_PATH/bin/activate"
      log_success "Virtual environment activated: $(which python)"
    else
      log_error "Virtual environment activation script does not exist"
    fi
  else
    log_warning "Python virtual environment does not exist: $VENV_PATH"
  fi
else
  log_error "Python not available"
  exit 1
fi

# Test Node.js environment
log_info "Testing Node.js environment..."
export NVM_DIR="/usr/local/nvm"

# Check NVM directory
if [ -d "$NVM_DIR" ]; then
  log_success "NVM directory exists: $NVM_DIR"
  
  # Check NVM script
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    log_success "NVM script exists"
    
    # Load NVM
    log_info "Loading NVM..."
    set +e  # Temporarily disable error exit
    . "$NVM_DIR/nvm.sh"
    NVM_LOAD_RESULT=$?
    set -e  # Re-enable error exit
    
    if [ $NVM_LOAD_RESULT -eq 0 ]; then
      log_success "NVM loaded successfully: $(nvm --version)"
      
      # Check Node.js
      if command -v node &> /dev/null; then
        log_success "Node.js available: $(node -v)"
        
        # Test Node.js execution
        node -e "console.log('Node.js running normally: ' + process.version)"
        log_success "Node.js execution test passed"
        
        # Check npm
        if command -v npm &> /dev/null; then
          log_success "npm available: $(npm -v)"
        else
          log_error "npm not available"
          exit 1
        fi
        
        # Check pnpm
        if command -v pnpm &> /dev/null; then
          log_success "pnpm available: $(pnpm -v)"
        else
          log_warning "pnpm not available, this may affect project dependency management"
        fi
      else
        log_error "Node.js not available"
        exit 1
      fi
    else
      log_error "NVM loading failed"
      exit 1
    fi
  else
    log_error "NVM script does not exist: $NVM_DIR/nvm.sh"
    exit 1
  fi
else
  log_error "NVM directory does not exist: $NVM_DIR"
  exit 1
fi

# Test project configuration
log_info "Testing project configuration..."

# Check package.json
if [ -f "package.json" ]; then
  log_success "package.json exists"
else
  log_warning "package.json does not exist, this may be normal depending on the current directory"
fi

# Check .nvmrc
if [ -f ".nvmrc" ]; then
  log_success ".nvmrc exists: $(cat .nvmrc)"
else
  log_warning ".nvmrc does not exist, this may be normal depending on the current directory"
fi

# Test shell configuration
log_info "Testing shell configuration..."
SHELL_CONFIG_FILES=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile")
for config_file in "${SHELL_CONFIG_FILES[@]}"; do
  if [ -f "$config_file" ]; then
    log_success "$config_file exists"
    
    # Check NVM configuration
    if grep -q "NVM_DIR" "$config_file"; then
      log_success "$config_file contains NVM configuration"
    else
      log_warning "$config_file does not contain NVM configuration"
    fi
    
    # Check Python virtual environment configuration
    if grep -q "VIRTUAL_ENV" "$config_file"; then
      log_success "$config_file contains Python virtual environment configuration"
    else
      log_warning "$config_file does not contain Python virtual environment configuration"
    fi
  else
    log_warning "$config_file does not exist"
  fi
done

# Test completed
log_success "===== DevContainer Environment Test Completed ====="
exit 0 