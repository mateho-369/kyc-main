import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-navy-950 border-t border-navy-800 py-4 mt-auto">
      <div className="container mx-auto px-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-wide">
              <span className="text-gold-400">Safe</span>
              <span className="text-navy-200">Video</span>
            </span>
            <nav className="flex space-x-4 text-sm">
              <Link
                to="/contact"
                className="text-navy-300 hover:text-gold-400 transition-colors duration-200"
              >
                お問い合わせ
              </Link>
              <Link
                to="/terms"
                className="text-navy-300 hover:text-gold-400 transition-colors duration-200"
              >
                利用規約
              </Link>
              <Link
                to="/privacy"
                className="text-navy-300 hover:text-gold-400 transition-colors duration-200"
              >
                プライバシーポリシー
              </Link>
            </nav>
          </div>
          <div className="text-navy-400 text-xs">
            &copy; 2026 Id Manager All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
