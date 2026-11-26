import { describe, expect, it, vi } from "vitest";
import {
  createVodPlaylistResigner,
  isTokenFormStreamUrl,
  playlistUris,
  providerSignedUrlKey,
  type PlaylistFetcher,
} from "@/lib/stream-playlist-refresh";

const uid = "0123456789abcdef0123456789abcdef";
const token = "aaa.bbb.ccc";

describe("stream playlist refresh helpers", () => {
  it("tells token-form Stream URLs from the ones Cloudflare signed itself", () => {
    expect(isTokenFormStreamUrl(`https://videodelivery.net/${token}/manifest/stream_x.m3u8`)).toBe(true);
    expect(isTokenFormStreamUrl(`https://customer-abc123.cloudflarestream.com/${token}/manifest/video.m3u8`)).toBe(true);
    expect(isTokenFormStreamUrl(`https://videodelivery.net/${uid}/video/720/seg_1.mp4?p=x&s=y`)).toBe(false);
    expect(isTokenFormStreamUrl(`https://example.com/${token}/manifest/video.m3u8`)).toBe(false);
    expect(isTokenFormStreamUrl("not a url")).toBe(false);
  });

  it("keys provider-signed URIs by path only, so the same resource signed for another token matches", () => {
    const first = providerSignedUrlKey(`https://videodelivery.net/${uid}/video/720/seg_1.mp4?p=old&s=1`);
    expect(first).toBe(`/${uid}/video/720/seg_1.mp4`);
    expect(providerSignedUrlKey(`https://customer-abc123.cloudflarestream.com/${uid}/video/720/seg_1.mp4?p=new&s=2`)).toBe(first);
    expect(providerSignedUrlKey(`https://videodelivery.net/${token}/manifest/stream_x.m3u8`)).toBeNull();
    expect(providerSignedUrlKey(`https://example.com/${uid}/video/720/seg_1.mp4?p=old`)).toBeNull();
    expect(providerSignedUrlKey(`http://videodelivery.net/${uid}/video/720/seg_1.mp4`)).toBeNull();
  });

  it("lists every URI a playlist references, resolved against the playlist URL", () => {
    const playlistUrl = `https://videodelivery.net/${token}/manifest/stream_x.m3u8`;
    const text = [
      "#EXTM3U",
      `#EXT-X-MAP:URI="/${uid}/video/720/init.mp4?p=a&s=b"`,
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="x",URI="audio_y.m3u8"',
      "#EXTINF:6.0,",
      `/${uid}/video/720/seg_1.mp4?p=a&s=b`,
      "",
      "#EXTINF:6.0,\r",
      `https://videodelivery.net/${uid}/video/720/seg_2.mp4?p=a&s=b\r`,
      "#EXT-X-ENDLIST",
    ].join("\n");
    expect(playlistUris(text, playlistUrl)).toEqual([
      `https://videodelivery.net/${uid}/video/720/init.mp4?p=a&s=b`,
      `https://videodelivery.net/${token}/manifest/audio_y.m3u8`,
      `https://videodelivery.net/${uid}/video/720/seg_1.mp4?p=a&s=b`,
      `https://videodelivery.net/${uid}/video/720/seg_2.mp4?p=a&s=b`,
    ]);
  });
});

describe("createVodPlaylistResigner", () => {
  const manifest = (value: string) => `https://videodelivery.net/${value}/manifest/video.m3u8`;
  const playlist = (value: string) => `https://videodelivery.net/${value}/manifest/stream_x.m3u8`;
  const segment = (p: string) => `https://videodelivery.net/${uid}/video/720/seg_1.mp4?p=${p}&s=sig`;
  const body = (p: string) => `#EXTM3U\n#EXTINF:6.0,\n/${uid}/video/720/seg_1.mp4?p=${p}&s=sig\n#EXT-X-ENDLIST\n`;
  const timers = { setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay), clearTimeout: (handle: unknown) => clearTimeout(handle as never) };

  function setup(fetchPlaylist: PlaylistFetcher) {
    const state = { url: manifest("a.b.c") };
    const resigner = createVodPlaylistResigner({
      initialUrl: state.url, currentUrl: () => state.url, heldPlaylists: () => [playlist("a.b.c")], fetchPlaylist, timers,
    });
    return { state, resigner };
  }

  it("keeps only the newest renewal's signatures when refreshes overlap", async () => {
    const answers: Array<(text: string) => void> = [];
    const { state, resigner } = setup(() => new Promise((resolve) => {
      answers.push((text) => resolve({ status: 200, text: async () => text }));
    }));
    state.url = manifest("r1.b.c");
    const first = resigner.refresh();
    state.url = manifest("r2.b.c");
    const second = resigner.refresh();
    expect(resigner.pending()).toBe(second);
    answers[1]!(body("r2"));
    await second;
    answers[0]!(body("r1"));
    await first;
    expect(resigner.requestUrlFor(segment("a"))).toBe(segment("r2"));
    expect(resigner.refresh()).toBeNull();
  });

  it("forgets re-signed URIs on reset, and aborts and ignores a refresh on dispose", async () => {
    const signals: AbortSignal[] = [];
    let answer: (text: string) => void = () => {};
    const { state, resigner } = setup((_url, signal) => {
      signals.push(signal);
      return new Promise((resolve) => { answer = (text) => resolve({ status: 200, text: async () => text }); });
    });
    state.url = manifest("r1.b.c");
    const running = resigner.refresh()!;
    answer(body("r1"));
    await running;
    expect(resigner.requestUrlFor(segment("a"))).toBe(segment("r1"));

    resigner.reset();
    expect(resigner.requestUrlFor(segment("a"))).toBe(segment("a"));
    // reset() marks the current URL as loaded by the player itself.
    expect(resigner.refresh()).toBeNull();

    state.url = manifest("r2.b.c");
    const disposed = resigner.refresh()!;
    resigner.dispose();
    expect(signals.at(-1)!.aborted).toBe(true);
    answer(body("r2"));
    await disposed;
    expect(resigner.requestUrlFor(segment("a"))).toBe(segment("a"));
    expect(resigner.refresh()).toBeNull();
  });

  it("does nothing without a player and treats no held VOD playlist as done", () => {
    const fetchPlaylist = vi.fn();
    let held: string[] | null = null;
    const state = { url: manifest("a.b.c") };
    const resigner = createVodPlaylistResigner({ initialUrl: state.url, currentUrl: () => state.url, heldPlaylists: () => held, fetchPlaylist, timers });
    state.url = manifest("r1.b.c");
    expect(resigner.refresh()).toBeNull();
    held = [];
    expect(resigner.refresh()).toBeNull();
    held = [playlist("a.b.c")];
    expect(resigner.refresh()).toBeNull();
    expect(fetchPlaylist).not.toHaveBeenCalled();
  });
});
