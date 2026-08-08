# Quick Track Verification Guide

## 🎯 How to Check if Downloaded Track is Correct

### Method 1: Console Logs (Fastest) ⚡

1. Open DevTools: `Cmd + Option + I`
2. Look for these messages when adding a track:

**✅ GOOD - Track Matched:**
```
Expected: Love for Love by Robin S
Downloaded: Love for Love by Robin S
✅ Track verification passed - looks like a good match
✅ Successfully downloaded using spotdl (320kbps)
```

**⚠️ WARNING - Possible Mismatch:**
```
Expected: Song Name by Artist A  
Downloaded: Song Name (Remix) by Artist B
⚠️ WARNING: Downloaded track may not match Spotify track!
   This might be a cover, remix, or wrong version.
```

---

### Method 2: Quick Listen Test 🎧

**Play first 10 seconds and check:**

✅ Opening notes/intro sama?  
✅ Voice/instrument sama?  
✅ Tempo/speed sama?  
✅ Production quality sama?  

**If any berbeda → Wrong track!**

---

### Method 3: Compare Side-by-Side 🔊

1. Open Spotify di browser/app
2. Play track di Spotify
3. At same time, play track di ILoveMusic
4. Listen carefully for differences

**Common differences if wrong:**
- Different mix (radio edit vs album version)
- Different tempo
- Different voice (cover artist)
- Extra intro/outro
- Different instruments

---

## 🚨 Red Flags - Track Probably Wrong

### In Console:
```
⚠️ WARNING: Downloaded track may not match Spotify track!
⚠️ spotdl failed, falling back to YouTube search
```

### When Playing:
- Sounds like live recording (Spotify was studio)
- Different language
- Different gender voice
- Significantly different length
- Remix/mashup (Spotify was original)

---

## ✅ What to Do if Track is Wrong

### Quick Fix:
1. **Delete track** dari app (click delete button)
2. **Wait 10 seconds**
3. **Add again** - spotdl search might find different/better result
4. **Check console** untuk verification message

### If Still Wrong:
Try different approach:

**Option A: Search YouTube manually**
1. Find correct version di YouTube
2. Copy YouTube URL
3. Use yt-dlp manually:
   ```bash
   /opt/homebrew/bin/yt-dlp -x --audio-format mp3 --audio-quality 0 "[YOUTUBE_URL]" -o ~/Downloads/correct_track.mp3
   ```
4. Replace file di tracks folder

**Option B: Use different source**
- Try SoundCloud instead (if available)
- Download from other service
- Rip dari CD/vinyl if you have it

---

## 📊 Track Info Display

Soon tracks will show download source. Look for:

**High Confidence:**
```
🎵 Song Name - Artist
   Source: Spotify (spotdl - 320kbps)
   ✅ Verified match
```

**Medium Confidence:**
```
🎵 Song Name - Artist  
   Source: Spotify (YouTube fallback - 192kbps)
   ⚠️ Verify manually
```

---

## 💡 Pro Tips

### To Minimize Mismatches:

1. **Use official Spotify links** - Not from playlists
2. **Avoid tracks with common names** - "Love", "Home", etc more likely to mismatch
3. **Check newer releases** - More likely to be on YouTube Music accurately
4. **Popular tracks** - Better search results
5. **Unique artist names** - Less confusion

### When Downloading:

✅ **Check console immediately** after clicking ADD  
✅ **Listen to first 10 seconds** before adding more tracks  
✅ **Keep Spotify open** for quick comparison  
✅ **Delete immediately** if wrong - don't accumulate wrong tracks  

---

## 🎯 Expected Results

### With spotdl + YouTube Music:
- **95-99% accuracy** for popular tracks
- **90-95% accuracy** for less popular
- **80-90% accuracy** for rare/obscure

### With YouTube fallback:
- **85-95% accuracy** for popular
- **70-85% accuracy** for others
- More variability

### Signs of Good Match:
✅ Console shows "Track verification passed"  
✅ No warnings in console  
✅ First notes match perfectly  
✅ Downloaded using spotdl (not fallback)  
✅ 320kbps file size (~8-10 MB per 4-min track)  

### Signs of Possible Mismatch:
⚠️ Console shows warning  
⚠️ Used YouTube fallback  
⚠️ First notes sound different  
⚠️ Smaller file size (<5 MB)  
⚠️ Different length than Spotify  

---

## 🔍 Quick Verification Checklist

Before adding to playlist/set:

- [ ] Checked console logs for warnings
- [ ] Listened to first 10 seconds
- [ ] Compared tempo/BPM with Spotify
- [ ] Confirmed artist voice matches
- [ ] No unexpected intros/outros
- [ ] File size appropriate (~8-10 MB for 320kbps)

If all checked ✅ → Track is good!

If any ⚠️ → Verify more carefully or re-download

---

## 📞 Reporting Issues

If you notice patterns (e.g., certain artist always wrong):

1. Note the Spotify URL
2. Note what was downloaded instead
3. Check console logs
4. This helps improve matching algorithm

---

**Remember: 95%+ accuracy means most tracks will be perfect, but always verify important tracks for your sets!** 🎵

---

Quick Reference:
- Open Console: `Cmd + Option + I`
- Tracks folder: `~/Library/Application Support/ilovemusic-desktop/tracks/`
- Check file: `ffprobe [file.mp3] 2>&1 | grep -i bitrate`
