# Cara Push ke GitHub - Autentikasi

## Opsi 1: Personal Access Token (Paling Mudah)

### Langkah-langkah:

1. **Buat Personal Access Token di GitHub:**
   - Buka: https://github.com/settings/tokens
   - Klik "Generate new token" → "Generate new token (classic)"
   - Beri nama: `ILoveMusic Push`
   - Pilih scope: ✅ **repo** (semua checkbox di bawah repo)
   - Klik "Generate token"
   - **COPY TOKEN** (hanya muncul sekali!)

2. **Push menggunakan token:**
   ```bash
   # Ubah remote ke HTTPS
   git remote set-url origin https://github.com/0xMochamad-Arif-Fahrizal/ILoveMusic.git
   
   # Push (akan diminta username dan password)
   # Username: 0xMochamad-Arif-Fahrizal
   # Password: PASTE_TOKEN_DISINI
   git push -u origin main
   ```

3. **Atau gunakan token langsung di URL:**
   ```bash
   git remote set-url origin https://TOKEN_DISINI@github.com/0xMochamad-Arif-Fahrizal/ILoveMusic.git
   git push -u origin main
   ```

---

## Opsi 2: SSH Key (Lebih Aman)

### Langkah-langkah:

1. **Generate SSH Key:**
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   # Tekan Enter untuk semua pertanyaan (default location)
   ```

2. **Copy public key:**
   ```bash
   cat ~/.ssh/id_ed25519.pub
   # Copy semua output
   ```

3. **Tambahkan ke GitHub:**
   - Buka: https://github.com/settings/keys
   - Klik "New SSH key"
   - Title: `MacBook` (atau nama lain)
   - Key: Paste public key yang sudah di-copy
   - Klik "Add SSH key"

4. **Test koneksi:**
   ```bash
   ssh -T git@github.com
   # Harus muncul: "Hi 0xMochamad-Arif-Fahrizal! You've successfully authenticated..."
   ```

5. **Push:**
   ```bash
   git push -u origin main
   ```

---

## Setelah Berhasil Push:

Repository akan tersedia di:
**https://github.com/0xMochamad-Arif-Fahrizal/ILoveMusic**

Orang lain bisa clone dengan:
```bash
git clone https://github.com/0xMochamad-Arif-Fahrizal/ILoveMusic.git
cd ILoveMusic
npm install
npm install --prefix renderer
npm run build:mac  # atau build:win
```


