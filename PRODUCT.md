# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML/CSS/JS UI (no build step) wrapped as a Windows desktop app with Tauri 2 for the `.exe`, auto-updates, and OBS/system control. The same UI also opens in a plain browser on other laptops, without the desktop-only features. Tauri chosen to match Jhems's other Windows apps (TubbyKeys, KiwiConvert, LodiSave).

## Users

A tech crew of two or three students running the Facebook Live broadcast of their org's esports event. Jhems leads and must be able to do everything alone. Others help at the same time, on the same PC or on their own laptops: switching screens, running music and audio, updating scores. Most of them have never used OBS.

## Product Purpose

JhemsStream is a control panel that sits on top of OBS. OBS captures, encodes and streams to Facebook. JhemsStream makes the show runnable by non-experts: pick what viewers see, transition smoothly, keep audio and music clean, and go live without learning OBS. Success means a six-hour stream (12pm to 6pm) with no dead air, no blaring or silent audio, no wrong screen on air, and helpers who could operate it after a minute of onboarding.

## Positioning

OBS has the power but expects an expert. Stream Deck-style tools only fire buttons. JhemsStream is a broadcast switcher built for a volunteer crew: Preview and TAKE with live thumbnails, a scoreboard, a music crossfader that follows the show, and one-click setup of OBS itself on the streaming PC.

## Operating Context

- An esports event at school, streamed to the org's Facebook Page through Facebook Live Producer using a stream key, never an API login.
- Games are played on other PCs and screen-shared to the streaming PC through Discord. The streaming PC captures the Discord stream window.
- Music comes from both audio files on the streaming PC and apps like Spotify or YouTube.
- Several operators can work at once from different laptops connected to the same OBS.
- Long live sessions, a venue with possibly unreliable internet, and pressure moments: going live, switching mid-match, emergencies.

## Capabilities and Constraints

- Controls OBS 28+ through obs-websocket v5: scenes, Preview/Program (studio mode), transitions, sources, audio, filters, stream and record outputs.
- obs-websocket cannot create scene transitions. Extra transitions need OBS setup. On the streaming PC, the desktop app may edit OBS config only while OBS is closed.
- Desktop app on the streaming PC: detect, install, configure, and launch OBS; read the local obs-websocket password to auto-connect; control per-app Windows volume (Spotify/YouTube); play music files into the stream through system audio; open quick links.
- Each release ships a Windows `.exe` installer. The app updates itself from GitHub Releases through an in-app button.
- Copyright: JhemsStream can only estimate risk from track metadata and known royalty-free sources. Facebook's own systems decide what gets muted or blocked. The UI must never claim a track is safe.
- Never stores the Facebook stream key.

## Brand Commitments

Name: JhemsStream. Open source (MIT) on GitHub at jherobred/JhemsStream, to be shown on Jhems's LinkedIn.

## Evidence on Hand

No real screenshots, logos, users, or testimonials yet. Do not invent usage numbers, partner orgs, or endorsements.

## Product Principles

1. The live output is sacred. Nothing reaches Program by accident. Risky actions confirm, and the on-air state is unmistakable.
2. Anyone can operate it after a minute. Plain words, visible state, and guidance at the moment it's needed.
3. Smooth by default. Audio fades and video transitions instead of cutting, unless the operator chooses a cut.
4. One crew, many hands. Every helper sees the same truth from OBS. No hidden local state that splits the crew.
5. Honest about limits. Say what the tool can't know, like copyright status or the venue's internet.

## Accessibility & Inclusion

Used under stress in a noisy venue, often on laptop screens. Large hit targets for show-critical actions, full keyboard operation, and state carried by more than color (on-air uses text and shape as well as red).
