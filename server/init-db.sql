-- Initial database setup for KYC staging
USE kyc_staging;

-- Create users table if not exists
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role ENUM('admin', 'user', 'moderator') DEFAULT 'user',
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create performers table if not exists
CREATE TABLE IF NOT EXISTS performers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lastName VARCHAR(255) NOT NULL,
    firstName VARCHAR(255) NOT NULL,
    lastNameRoman VARCHAR(255),
    firstNameRoman VARCHAR(255),
    status VARCHAR(50) DEFAULT 'active',
    kycStatus VARCHAR(50) DEFAULT 'pending',
    documents JSON,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert test users (passwords are hashed for 'password123' and 'admin123')
INSERT INTO users (email, password, name, role) VALUES 
('admin@example.com', '$2b$10$X7ixP5C8KmJh.FU7LOUaAuBSsKH7SS7rE5VJrXqzWsHobH9vqGFe2', 'Admin User', 'admin'),
('test@example.com', '$2b$10$8EWJvJ5YvXpVkGXQXyPfhOWKoV.cNqTQmVQB8VrZgLNFqdpkfYCZa', 'Test User', 'user')
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- Insert sample performers
INSERT INTO performers (lastName, firstName, lastNameRoman, firstNameRoman, status, kycStatus) VALUES
('田中', '太郎', 'Tanaka', 'Taro', 'active', 'verified'),
('佐藤', '花子', 'Sato', 'Hanako', 'active', 'pending'),
('鈴木', '一郎', 'Suzuki', 'Ichiro', 'active', 'verified')
ON DUPLICATE KEY UPDATE status=VALUES(status);