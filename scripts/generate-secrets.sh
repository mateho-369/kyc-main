#!/bin/bash

# ==========================================
# SafeVideo Secret Generation Script
# ==========================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to generate secure random strings
generate_password() {
    local length=${1:-32}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to generate secure secrets
generate_secret() {
    local length=${1:-64}
    openssl rand -base64 $length | tr -d "\n"
}

echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}SafeVideo Secret Generation${NC}"
echo -e "${GREEN}===========================================${NC}"

# Create secrets directory
SECRETS_DIR="./secrets"
if [ ! -d "$SECRETS_DIR" ]; then
    mkdir -p "$SECRETS_DIR"
    chmod 700 "$SECRETS_DIR"
    echo -e "${GREEN}✓${NC} Created secrets directory"
else
    echo -e "${YELLOW}!${NC} Secrets directory already exists"
fi

# Generate secrets
echo -e "\n${GREEN}Generating secure secrets...${NC}"

# Database passwords
echo -n "$(generate_password 32)" > "$SECRETS_DIR/mysql_root_password.txt"
echo -e "${GREEN}✓${NC} Generated MySQL root password"

echo -n "$(generate_password 32)" > "$SECRETS_DIR/db_password.txt"
echo -e "${GREEN}✓${NC} Generated database password"

# JWT and session secrets
echo -n "$(generate_secret 64)" > "$SECRETS_DIR/jwt_secret.txt"
echo -e "${GREEN}✓${NC} Generated JWT secret"

echo -n "$(generate_secret 32)" > "$SECRETS_DIR/session_secret.txt"
echo -e "${GREEN}✓${NC} Generated session secret"

# Redis password
echo -n "$(generate_password 32)" > "$SECRETS_DIR/redis_password.txt"
echo -e "${GREEN}✓${NC} Generated Redis password"

# Set secure permissions
chmod 600 "$SECRETS_DIR"/*.txt
echo -e "${GREEN}✓${NC} Set secure permissions on secret files"

# Generate .env file from .env.example
if [ -f ".env.example" ]; then
    echo -e "\n${GREEN}Generating .env file...${NC}"
    
    # Copy example file
    cp .env.example .env
    
    # Read secrets and update .env
    DB_PASSWORD=$(cat "$SECRETS_DIR/db_password.txt")
    MYSQL_ROOT_PASSWORD=$(cat "$SECRETS_DIR/mysql_root_password.txt")
    JWT_SECRET=$(cat "$SECRETS_DIR/jwt_secret.txt")
    SESSION_SECRET=$(cat "$SECRETS_DIR/session_secret.txt")
    REDIS_PASSWORD=$(cat "$SECRETS_DIR/redis_password.txt")
    
    # Update .env file with generated secrets
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/DB_PASSWORD=.*/DB_PASSWORD=${DB_PASSWORD}/" .env
        sed -i '' "s/MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}/" .env
        sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" .env
        sed -i '' "s/SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" .env
        sed -i '' "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" .env
    else
        # Linux
        sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=${DB_PASSWORD}/" .env
        sed -i "s/MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}/" .env
        sed -i "s/JWT_SECRET=.*/JWT_SECRET=${JWT_SECRET}/" .env
        sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=${SESSION_SECRET}/" .env
        sed -i "s/REDIS_PASSWORD=.*/REDIS_PASSWORD=${REDIS_PASSWORD}/" .env
    fi
    
    chmod 600 .env
    echo -e "${GREEN}✓${NC} Generated .env file with secrets"
else
    echo -e "${YELLOW}!${NC} .env.example not found"
fi

# Create .gitignore for secrets
cat > "$SECRETS_DIR/.gitignore" << EOF
# Ignore all files in this directory
*
# Except this file
!.gitignore
EOF

echo -e "\n${GREEN}===========================================${NC}"
echo -e "${GREEN}Secret generation completed successfully!${NC}"
echo -e "${GREEN}===========================================${NC}"

echo -e "\n${YELLOW}IMPORTANT SECURITY NOTES:${NC}"
echo -e "1. ${RED}NEVER${NC} commit these secrets to version control"
echo -e "2. ${RED}NEVER${NC} share these files or their contents"
echo -e "3. Back up these secrets in a secure location"
echo -e "4. Use different secrets for each environment"
echo -e "5. Rotate secrets regularly"

echo -e "\n${GREEN}Next steps:${NC}"
echo -e "1. Review and update the .env file with your specific settings"
echo -e "2. Update REACT_APP_API_URL and other environment-specific values"
echo -e "3. Run: docker-compose -f docker-compose.secure.yml up -d"