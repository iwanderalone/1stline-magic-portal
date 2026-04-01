import os
os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

def test_encrypt_decrypt_roundtrip():
    from app.core.encryption import encrypt, decrypt
    plaintext = "my-imap-password-123"
    ciphertext = encrypt(plaintext)
    assert ciphertext != plaintext
    assert decrypt(ciphertext) == plaintext

def test_encrypt_returns_different_each_time():
    from app.core.encryption import encrypt
    a = encrypt("password")
    b = encrypt("password")
    assert a != b  # Fernet uses random IV

def test_empty_string_passthrough():
    from app.core.encryption import encrypt, decrypt
    assert encrypt("") == ""
    assert decrypt("") == ""

def test_decrypt_invalid_token_raises():
    from app.core.encryption import decrypt
    import pytest
    with pytest.raises(Exception):
        decrypt("not-a-valid-fernet-token")
