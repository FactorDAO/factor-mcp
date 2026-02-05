#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Factor MCP installation directory
INSTALL_DIR="${HOME}/.factor-mcp"
BIN_DIR="${HOME}/.local/bin"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           Factor MCP Server - Installation Script         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check Node.js version
check_node_version() {
    if command_exists node; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            return 0
        fi
    fi
    return 1
}

# Check OS
OS="$(uname -s)"
case "$OS" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=macos;;
    *)          echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1;;
esac

echo -e "${BLUE}[1/6]${NC} Checking Node.js..."
if check_node_version; then
    echo -e "${GREEN}✓${NC} Node.js $(node -v) is installed"
else
    echo -e "${YELLOW}Node.js 18+ is required${NC}"
    echo ""
    if [ "$PLATFORM" = "macos" ]; then
        echo "Install Node.js with Homebrew:"
        echo "  brew install node"
    else
        echo "Install Node.js:"
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "  sudo apt-get install -y nodejs"
    fi
    echo ""
    read -p "Do you want to continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${BLUE}[2/6]${NC} Checking Rust..."
if command_exists rustc; then
    echo -e "${GREEN}✓${NC} Rust $(rustc --version | cut -d' ' -f2) is installed"
else
    echo -e "${YELLOW}Installing Rust...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "${HOME}/.cargo/env"
    echo -e "${GREEN}✓${NC} Rust installed"
fi

# Ensure cargo is in PATH
if [ -f "${HOME}/.cargo/env" ]; then
    source "${HOME}/.cargo/env"
fi

echo -e "${BLUE}[3/6]${NC} Checking Foundry..."
if command_exists cast && command_exists anvil && command_exists forge; then
    echo -e "${GREEN}✓${NC} Foundry $(cast --version | head -1 | cut -d' ' -f2) is installed"
else
    echo -e "${YELLOW}Installing Foundry...${NC}"
    curl -L https://foundry.paradigm.xyz | bash

    # Source foundry env
    if [ -f "${HOME}/.bashrc" ]; then
        source "${HOME}/.bashrc" 2>/dev/null || true
    fi
    if [ -f "${HOME}/.zshrc" ]; then
        source "${HOME}/.zshrc" 2>/dev/null || true
    fi

    # Add foundry to path for this session
    export PATH="${HOME}/.foundry/bin:${PATH}"

    # Run foundryup
    "${HOME}/.foundry/bin/foundryup"
    echo -e "${GREEN}✓${NC} Foundry installed"
fi

echo -e "${BLUE}[4/6]${NC} Creating installation directory..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${BIN_DIR}"
cd "${INSTALL_DIR}"

echo -e "${BLUE}[5/6]${NC} Downloading Factor MCP Server..."
if command_exists git; then
    if [ -d "${INSTALL_DIR}/.git" ]; then
        echo "Updating existing installation..."
        git pull origin main
    else
        rm -rf "${INSTALL_DIR:?}"/*
        git clone https://github.com/FactorDAO/factor-mcp.git .
    fi
else
    echo -e "${YELLOW}Git not found, downloading archive...${NC}"
    curl -sL https://github.com/FactorDAO/factor-mcp/archive/refs/heads/main.tar.gz | tar xz --strip-components=1
fi

echo -e "${BLUE}[6/6]${NC} Installing dependencies and building..."
npm install --silent
npm run build

# Create wrapper script
cat > "${BIN_DIR}/factor-mcp" << 'EOF'
#!/bin/bash
export PATH="${HOME}/.foundry/bin:${HOME}/.cargo/bin:${PATH}"
node "${HOME}/.factor-mcp/dist/index.js" "$@"
EOF
chmod +x "${BIN_DIR}/factor-mcp"

# Create config directory
mkdir -p "${HOME}/.factor-mcp/wallets"

# Add to PATH if needed
if [[ ":$PATH:" != *":${BIN_DIR}:"* ]]; then
    echo ""
    echo -e "${YELLOW}Add this to your shell profile (.bashrc, .zshrc, etc.):${NC}"
    echo -e "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Factor MCP Server installed successfully!         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "To use with Claude Desktop, add to your config:"
echo ""
echo -e "${BLUE}~/.config/claude/claude_desktop_config.json (Linux)${NC}"
echo -e "${BLUE}~/Library/Application Support/Claude/claude_desktop_config.json (macOS)${NC}"
echo ""
cat << 'CONFIGEOF'
{
  "mcpServers": {
    "factor": {
      "command": "node",
      "args": ["${HOME}/.factor-mcp/dist/index.js"],
      "env": {
        "ALCHEMY_API_KEY": "your-api-key-here"
      }
    }
  }
}
CONFIGEOF
echo ""
echo -e "Or run directly: ${GREEN}factor-mcp${NC}"
echo ""
