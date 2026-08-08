# Cara Push ke GitHub

## 1. Buat Repository di GitHub
- Buka https://github.com
- Klik "New repository" (tombol hijau)
- Isi nama: `ILoveMusic` (atau nama lain)
- Jangan centang "Initialize with README"
- Klik "Create repository"

## 2. Push ke GitHub
Setelah repository dibuat, jalankan perintah berikut (ganti YOUR_USERNAME dengan username GitHub Anda):

```bash
# Tambahkan remote repository
git remote add origin https://github.com/YOUR_USERNAME/ILoveMusic.git

# Rename branch ke main (jika perlu)
git branch -M main

# Push ke GitHub
git push -u origin main
```

## 3. Jika menggunakan SSH (lebih aman):
```bash
git remote add origin git@github.com:YOUR_USERNAME/ILoveMusic.git
git branch -M main
git push -u origin main
```

## Catatan:
- File yang TIDAK di-upload ke GitHub:
  - `node_modules/` (terlalu besar)
  - `dist/` (build output)
  - `build/bin/` (binary files seperti yt-dlp)
  
- File yang DI-upload:
  - Semua source code
  - Configuration files
  - Assets (music, images, videos)
  - package.json (untuk install dependencies)

## Setelah di GitHub:
User lain bisa clone dan install dengan:
```bash
git clone https://github.com/YOUR_USERNAME/ILoveMusic.git
cd ILoveMusic
npm install
npm install --prefix renderer
```


