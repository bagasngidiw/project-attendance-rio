/**
 * BcryptPasswordHasher — one-way password hashing used for storage and
 * verification. Plaintext passwords never leave the application boundary.
 */

const bcrypt = require("bcryptjs");

class BcryptPasswordHasher {
  constructor(rounds = 12) {
    this.rounds = rounds;
  }

  /**
   * @param {string} plaintext
   * @returns {Promise<string>} bcrypt hash
   */
  hash(plaintext) {
    return bcrypt.hash(plaintext, this.rounds);
  }

  /**
   * @param {string} plaintext
   * @param {string} hash
   * @returns {Promise<boolean>}
   */
  verify(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
  }
}

module.exports = { BcryptPasswordHasher };
