# Voxyl: Social Podcast Playlists

**Voxyl** is a modern social podcast aggregator designed to give listeners total control over their audio streams. By blending traditional RSS technology with social curation, Voxyl allows users to build, share, and discover unique audio experiences.

<p align="center">
  <img src="promo/banner.png" width="100%">
</p>

---

## Try It Out

Voxyl is currently in its beta phase. You can access the web version and start testing the app immediately at the following link:

**[Access Voxyl Web App](https://voxyl-app.base44.app/)**

---

## Key Features

* **Smart RSS Aggregation:** Combine up to 5 different RSS feeds into a single, seamless playlist.
* **Social Discovery:** Follow friends and fellow curators to see what they are listening to.
* **Guest Mode:** Explore trending content and public playlists instantly without needing an account.
* **Advanced Playback:** Persistent hybrid caching ensures a smooth listening experience, even with fluctuating connections.
* **UI/UX:** Fully responsive design with native support for Light, Dark, and System-Automatic themes.

---

## Screenshots

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/1.png" width="200" alt="Screenshot 1">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/2.png" width="200" alt="Screenshot 2">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/3.png" width="200" alt="Screenshot 3">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/4.png" width="200" alt="Screenshot 4">
</p>

<p align="center">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/5.png" width="200" alt="Screenshot 5">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/6.png" width="200" alt="Screenshot 6">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/7.png" width="200" alt="Screenshot 7">
  <img src="screenshot/Voxyl%20-%20Apple%20resolution/8.png" width="200" alt="Screenshot 8">
</p>

---

## Project Structure

```txt
android/      Native Android Capacitor project
base44/       Base44 entities and server functions
docs/         Setup, auth, and release documentation
patches/      patch-package fixes applied after npm install
promo/        Public marketing images used by the README
public/       Static web assets and PWA files
screenshot/   App Store and product screenshots
src/          React application source
```

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run build
```

For native Android work:

```bash
npm run build
npx cap sync android
```

## Documentation

- [Changelog](CHANGELOG.md)
- [Android OAuth setup](docs/android-auth-setup.md)
- [Android manual auth callback test](docs/android-auth-manual-test.md)
- [iOS native setup](docs/ios-setup.md)

---

## Support & Bug Reporting

This repository serves as the official support hub for Voxyl. If you encounter any issues or have suggestions, please let us know:

**GitHub Issues:** [Open a new issue](https://github.com/Renbrant/voxyl/issues) describing the problem.

---

## Privacy & Safety

We take user privacy seriously. Voxyl is built with transparency in mind:

* **Data Minimization:** We only collect essential data (Name/Email) required for account functionality.
* **Account Control:** Users can delete their account and all associated data at any time via the Profile Settings.
* **Privacy Policy:** Detailed information can be found [here](https://voxyl-app.base44.app/privacy).

---

## Powered By

This project was built and is powered by:

Base44: An AI-driven, no-code development platform used as the primary environment for constructing and publishing the fully functional custom Voxyl application.

---

## About the Developer

Voxyl is developed by **Renato Brant**, a Brazilian Mechatronic Engineer based in Colorado. Passionate about technology and dedicated to sharing knowledge, Renato also hosts the **[Brant Channel](https://www.youtube.com/@Brant_Channel)** on YouTube. This project merges a background in high-tech automation with a love for filmmaking and photography, aiming to create a more organized and social way to consume long-form audio content.

---

*Voxyl is currently in Version 2.5 (Beta). Thank you for helping us shape the future of social podcasting!*
