Twitch LaneSplice

This repository is a fork of the original project by imhysderekal.

Original repository:
https://github.com/imhysderekal/TwitchAdBlocking

All original credit for the underlying implementation goes to imhysderekal.

This fork is maintained separately and may contain independent changes in the future.

Please refer to the original repository for the upstream version and development history.

Original author: @imhysderekal
Fork: Independent fork of TwitchAdBlocking
Main file: twitch_lanesplice_ublock_origin.js

A uBlock Origin script designed to reduce stitched advertisements on Twitch by using alternative playback lanes while preserving the original stream quality.

Overview

This repository contains a single JavaScript file:

twitch_lanesplice_ublock_origin.js

The script implements LaneSplice, a technique that works with Twitch's HLS playback system to identify advertisement segments and reconstruct the stream timeline using clean segments from alternative playback lanes.

Its main goals are:

Reduce interruptions caused by server-side stitched advertisements.
Preserve the original video resolution, frame rate and codec.
Avoid unnecessary player reloads or quality downgrades.
Maintain consistent playback timelines across different playback sessions.

The script is intended to work with Twitch through uBlock Origin's scriptlet/resource-loading capabilities.

Installation
Make sure you have uBlock Origin installed.
Download twitch_lanesplice_ublock_origin.js from this repository.
Follow the appropriate uBlock Origin configuration and resource-loading instructions to integrate the script.
Reload Twitch and check the browser console for [LaneSplice] messages.

Note: This repository contains the JavaScript file only. It does not include an automated installation system or a complete uBlock Origin configuration.

How It Works

LaneSplice operates by:

Intercepting Twitch's video worker and relevant HLS playlist requests.
Identifying advertisement-related segments in the playback playlists.
Requesting alternative playback lanes for the same stream.
Collecting clean segments from alternative lanes that match the original rendition.
Reconstructing the playback timeline while preserving segment sequence numbers and timestamps.

The script deliberately avoids switching to lower-quality renditions when an exact match is unavailable.

Repository Structure
text
.
└── twitch_lanesplice_ublock_origin.js

Disclaimer
This project is not affiliated with, endorsed by, or sponsored by Twitch Interactive.
Twitch may change its playback infrastructure, APIs or authentication mechanisms at any time.
Compatibility and functionality are not guaranteed.
Use this script at your own discretion.
This repository is provided for educational and experimental purposes.
Credits & Attribution
