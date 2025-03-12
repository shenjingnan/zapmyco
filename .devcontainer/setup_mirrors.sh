#!/bin/bash
set -e

echo "Configuring mirror sources..."

# Configure APT sources
if [ -n "$DEBIAN_MIRROR" ]; then
    echo "Configuring APT source: $DEBIAN_MIRROR (using traditional format)"
    
    # Directly modify sources.list file, using traditional format
    cat > /etc/apt/sources.list << EOF
# Main sources
deb $DEBIAN_MIRROR bookworm main contrib non-free non-free-firmware
deb $DEBIAN_MIRROR bookworm-updates main contrib non-free non-free-firmware
deb $DEBIAN_MIRROR bookworm-backports main contrib non-free non-free-firmware
EOF

    echo "APT source configuration completed"
fi

if [ -n "$DEBIAN_SECURITY_MIRROR" ]; then
    echo "Configuring APT security source: $DEBIAN_SECURITY_MIRROR (using traditional format)"
    
    # Add security update source to sources.list
    cat >> /etc/apt/sources.list << EOF
# Security update source
deb $DEBIAN_SECURITY_MIRROR bookworm-security main contrib non-free non-free-firmware
EOF

    echo "APT security source configuration completed"
fi

# Verify APT source configuration
if [ -n "$DEBIAN_MIRROR" ] || [ -n "$DEBIAN_SECURITY_MIRROR" ]; then
    echo "Verifying APT source configuration..."
    apt-get update -o Acquire::http::No-Cache=True || {
        echo "APT source configuration verification failed, restoring backup..."
        if [ -f /etc/apt/sources.list.bak ]; then
            cp /etc/apt/sources.list.bak /etc/apt/sources.list
            apt-get update -o Acquire::http::No-Cache=True
        fi
    }
fi

# Configure pip to use mirror
if [ -n "$PIP_MIRROR" ]; then
    echo "Configuring pip mirror: $PIP_MIRROR"
    # Create configuration directory (if it doesn't exist)
    mkdir -p ~/.config/pip
    # Write directly to configuration file, avoiding potential permission issues with pip command
    cat > ~/.config/pip/pip.conf << EOF
[global]
index-url = $PIP_MIRROR
EOF
    echo "pip mirror configuration completed"
    
    # Configure Poetry to use the same mirror
    if command -v poetry &> /dev/null; then
        echo "Configuring Poetry to use pip mirror: $PIP_MIRROR"
        poetry source add --priority=primary mirrors $PIP_MIRROR
        poetry config repositories.pypi $PIP_MIRROR
        poetry config http-basic.pypi.username ""
        poetry config http-basic.pypi.password ""
        echo "Poetry mirror configuration completed"
    else
        echo "Poetry command not available, skipping Poetry mirror configuration"
    fi
fi

# Configure npm to use mirror
if [ -n "$NPM_MIRROR" ] && command -v npm &> /dev/null; then
    echo "Configuring npm mirror: $NPM_MIRROR"
    npm config set registry "$NPM_MIRROR"
    echo "npm mirror configuration completed"
else
    echo "npm command not available or NPM_MIRROR not set, skipping npm mirror configuration"
fi

# Display Node.js mirror configuration information
if [ -n "$NVM_NODEJS_ORG_MIRROR" ]; then
    echo "Using Node.js mirror: $NVM_NODEJS_ORG_MIRROR"
fi

echo "Mirror source configuration completed!" 