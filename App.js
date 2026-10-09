import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import localAlbums from "./src/localMusic";

const cover = require("./assets/emmanuel-photo.png");
const STORE_KEY = "emmanuel.music.state.v2";
const DEFAULT_QUERY = "";
let AudioModule = null;
let FileSystemModule = null;

function getAudio() {
  if (!AudioModule) AudioModule = require("expo-av").Audio;
  return AudioModule;
}

function getFileSystem() {
  if (!FileSystemModule) FileSystemModule = require("expo-file-system");
  return FileSystemModule;
}

function downloadDir() {
  const FileSystem = getFileSystem();
  return `${FileSystem.documentDirectory}emmanuel-audio/`;
}

function text(value, fallback = "Desconocido") {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || fallback;
  return value || fallback;
}

function archiveFileUrl(identifier, fileName) {
  return `https://archive.org/download/${identifier}/${fileName.split("/").map(encodeURIComponent).join("/")}`;
}

function localUri(track) {
  return `${downloadDir()}${`${track.id}.mp3`.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;
}

function formatCount(value) {
  if (!value) return "0";
  if (value > 999999) return `${Math.round(value / 100000) / 10}M`;
  if (value > 999) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

async function fetchArchiveAlbums(term = DEFAULT_QUERY) {
  const q = encodeURIComponent(`mediatype:audio AND (${term})`);
  const fields = ["identifier", "title", "creator", "downloads", "date"].map((field) => `fl[]=${field}`).join("&");
  const url = `https://archive.org/advancedsearch.php?q=${q}&${fields}&rows=10&page=1&sort[]=downloads desc&output=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("No se pudo buscar musica.");
  const docs = (await response.json())?.response?.docs || [];

  const albums = await Promise.all(docs.slice(0, 8).map(async (doc) => {
    const metadataResponse = await fetch(`https://archive.org/metadata/${doc.identifier}`);
    if (!metadataResponse.ok) return null;
    const metadata = await metadataResponse.json();
    const files = (metadata.files || [])
      .filter((file) => {
        const name = `${file.name || ""}`;
        const format = `${file.format || ""}`.toLowerCase();
        return !file.private && (name.toLowerCase().endsWith(".mp3") || format.includes("mp3"));
      })
      .slice(0, 18);

    if (!files.length) return null;

    const artist = text(metadata.metadata?.creator || doc.creator, "Artista desconocido");
    const title = text(metadata.metadata?.title || doc.title, "Album sin titulo");
    const artwork = `https://archive.org/services/img/${doc.identifier}`;

    return {
      id: doc.identifier,
      title,
      artist,
      artwork,
      year: `${doc.date || ""}`.slice(0, 4),
      downloads: Number(doc.downloads || 0),
      tracks: files.map((file, index) => ({
        id: `${doc.identifier}-${index}`,
        identifier: doc.identifier,
        title: text(file.title || file.name, `Pista ${index + 1}`).replace(/\.(mp3|MP3)$/g, ""),
        artist,
        album: title,
        albumId: doc.identifier,
        artwork,
        duration: file.length ? `${Math.floor(Number(file.length) / 60)}:${String(Math.floor(Number(file.length) % 60)).padStart(2, "0")}` : "--:--",
        url: archiveFileUrl(doc.identifier, file.name)
      }))
    };
  }));

  return albums.filter(Boolean);
}

function Pill({ active, children, icon }) {
  return (
    <View style={[styles.pill, active && styles.pillActive]}>
      {icon}
      <Text style={[styles.pillText, active && styles.pillTextActive]}>{children}</Text>
    </View>
  );
}

function Artwork({ uri, size = 58 }) {
  return (
    <View style={[styles.artwork, { width: size, height: size }]}>
      {uri ? <Image source={{ uri }} style={styles.artworkImage} /> : <Ionicons name="musical-notes" size={size * 0.36} color="#ffffff" />}
    </View>
  );
}

function TrackRow({ item, active, downloaded, inPlaylist, busy, onPress, onDownload, onSave }) {
  return (
    <Pressable style={[styles.trackRow, active && styles.trackRowActive]} onPress={onPress}>
      <Artwork uri={item.artwork} />
      <View style={styles.trackMeta}>
        <Text numberOfLines={1} style={styles.trackTitle}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.trackSub}>{item.artist} · {item.album}</Text>
      </View>
      <Text style={styles.duration}>{item.duration}</Text>
      <Pressable hitSlop={12} onPress={onSave}>
        <Ionicons name={inPlaylist ? "heart" : "heart-outline"} size={24} color={inPlaylist ? "#ff4f9a" : "#d7dcff"} />
      </Pressable>
      <Pressable hitSlop={12} onPress={onDownload}>
        {busy ? <ActivityIndicator size="small" color="#24e3a4" /> : <Ionicons name={downloaded ? "checkmark-circle" : "arrow-down-circle-outline"} size={25} color={downloaded ? "#24e3a4" : "#d7dcff"} />}
      </Pressable>
    </Pressable>
  );
}

function MiniStat({ icon, value, label }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color="#c7d0ff" />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function App() {
  const soundRef = useRef(null);
  const [tab, setTab] = useState("home");
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [albums, setAlbums] = useState(localAlbums);
  const [playlistIds, setPlaylistIds] = useState([]);
  const [downloaded, setDownloaded] = useState({});
  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [repeat, setRepeat] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState("Biblioteca local lista sin internet");

  const tracks = useMemo(() => albums.flatMap((album) => album.tracks), [albums]);
  const playlist = useMemo(() => tracks.filter((track) => playlistIds.includes(track.id)), [tracks, playlistIds]);

  useEffect(() => {
    restore();
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ playlistIds, downloaded })).catch(() => {});
  }, [playlistIds, downloaded]);

  async function restore() {
    try {
      const saved = await AsyncStorage.getItem(STORE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setPlaylistIds(parsed.playlistIds?.length ? parsed.playlistIds : localAlbums.flatMap((album) => album.tracks.map((track) => track.id)));
        setDownloaded(parsed.downloaded || {});
      } else {
        setPlaylistIds(localAlbums.flatMap((album) => album.tracks.map((track) => track.id)));
      }
      setCurrent(localAlbums[0]?.tracks[0] || null);
      setLoading(false);
    } catch {
      setStatus("No se pudo cargar el catalogo inicial.");
    }
  }

  async function search(term = query) {
    setLoading(true);
    setStatus("Buscando en tus canciones...");
    try {
      const normalized = (term || "").trim().toLowerCase();
      const localResult = localAlbums
        .map((album) => ({
          ...album,
          tracks: album.tracks.filter((track) =>
            !normalized ||
            [track.title, track.artist, track.album].some((value) => `${value}`.toLowerCase().includes(normalized))
          )
        }))
        .filter((album) => album.tracks.length);
      const result = localResult.length ? localResult : await fetchArchiveAlbums(term || "creative commons music");
      setAlbums(result);
      setCurrent((old) => old || result[0]?.tracks[0] || null);
      setStatus(localResult.length ? "Resultados de tu biblioteca local" : "Resultados descargables encontrados online");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function play(track = current) {
    if (!track) return;
    try {
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const source = track.asset || { uri: downloaded[track.id] || track.url };
      const Audio = getAudio();
      await Audio.setAudioModeAsync({ staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true }).catch(() => {});
      const { sound } = await Audio.Sound.createAsync(source, { shouldPlay: true });
      sound.setOnPlaybackStatusUpdate((playback) => {
        if (playback.didJustFinish) repeat ? play(track) : playNext();
      });
      soundRef.current = sound;
      setCurrent(track);
      setIsPlaying(true);
      setStatus(track.asset || downloaded[track.id] ? "Reproduciendo offline" : "Reproduciendo online");
    } catch {
      Alert.alert("Audio", "No pude reproducir esta pista. Prueba otra del catalogo.");
    }
  }

  async function togglePlay() {
    if (!soundRef.current) return play(current);
    const state = await soundRef.current.getStatusAsync();
    if (state.isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
    }
  }

  function playNext() {
    const list = playlist.length ? playlist : tracks;
    if (!list.length) return;
    if (shuffle) return play(list[Math.floor(Math.random() * list.length)]);
    const index = list.findIndex((track) => track.id === current?.id);
    play(list[(index + 1 + list.length) % list.length]);
  }

  function togglePlaylist(track) {
    setPlaylistIds((items) => items.includes(track.id) ? items.filter((id) => id !== track.id) : [...items, track.id]);
  }

  async function downloadTrack(track, silent = false) {
    setBusyId(track.id);
    try {
      if (track.asset) {
        setDownloaded((items) => ({ ...items, [track.id]: "bundled" }));
        setStatus(`Lista offline: ${track.title}`);
        return;
      }
      const FileSystem = getFileSystem();
      await FileSystem.makeDirectoryAsync(downloadDir(), { intermediates: true });
      const destination = localUri(track);
      const info = await FileSystem.getInfoAsync(destination);
      if (!info.exists) await FileSystem.downloadAsync(track.url, destination);
      setDownloaded((items) => ({ ...items, [track.id]: destination }));
      setStatus(`Descargada: ${track.title}`);
    } catch {
      if (!silent) Alert.alert("Descarga", "No pude descargar esta pista. Puede que el archivo no este disponible.");
    } finally {
      setBusyId(null);
    }
  }

  async function downloadAlbum(album) {
    setPlaylistIds((items) => Array.from(new Set([...items, ...album.tracks.map((track) => track.id)])));
    for (const track of album.tracks) {
      if (!isOffline(track)) await downloadTrack(track);
    }
  }

  async function downloadPlaylist() {
    for (const track of playlist) {
      if (!isOffline(track)) await downloadTrack(track);
    }
  }

  const isOffline = (track) => Boolean(track.asset || downloaded[track.id]);
  const allDownloaded = playlist.length > 0 && playlist.every(isOffline);

  const renderHome = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <ImageBackground source={cover} resizeMode="cover" style={styles.heroImage} imageStyle={styles.heroImageInner}>
        <View style={styles.heroOverlay}>
          <View style={styles.brandRow}>
            <Image source={cover} style={styles.avatar} />
            <View>
              <Text style={styles.brandLabel}>EMMANUEL</Text>
              <Text style={styles.brandSmall}>Premium sin anuncios</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Musica real, playlist propia y modo offline.</Text>
          <View style={styles.pills}>
            <Pill active icon={<Ionicons name="cloud-download" size={16} color="#ffffff" />}>Descargas</Pill>
            <Pill active={shuffle} icon={<Ionicons name="shuffle" size={16} color={shuffle ? "#ffffff" : "#ccd3ff"} />}>Random</Pill>
            <Pill icon={<Ionicons name="musical-notes" size={16} color="#ccd3ff" />}>Local</Pill>
          </View>
        </View>
      </ImageBackground>

      <View style={styles.stats}>
        <MiniStat icon="musical-notes" value={tracks.length} label="Canciones" />
        <MiniStat icon="albums" value={albums.length} label="Albumes" />
        <MiniStat icon="cloud-done" value={tracks.filter(isOffline).length} label="Offline" />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recomendado</Text>
        <Text style={styles.sectionAction}>{status}</Text>
      </View>
      {loading ? <ActivityIndicator color="#ffffff" style={styles.loader} /> : tracks.slice(0, 6).map((track) => (
        <TrackRow
          key={track.id}
          item={track}
          active={current?.id === track.id}
          downloaded={isOffline(track)}
          inPlaylist={playlistIds.includes(track.id)}
          busy={busyId === track.id}
          onPress={() => play(track)}
          onDownload={() => downloadTrack(track)}
          onSave={() => togglePlaylist(track)}
        />
      ))}
    </ScrollView>
  );

  const renderSearch = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Buscar</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={22} color="#8f9ada" />
        <TextInput
          placeholder="Cantante, musica o album"
          placeholderTextColor="#858dbb"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => search(query)}
          style={styles.searchInput}
          returnKeyType="search"
        />
        <Pressable style={styles.iconButton} onPress={() => search(query)}>
          <Ionicons name="arrow-forward" size={19} color="#071024" />
        </Pressable>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Albumes completos</Text>
        <Text style={styles.sectionAction}>{loading ? "Buscando" : `${albums.length} resultados`}</Text>
      </View>
      {albums.map((album) => (
        <View key={album.id} style={styles.albumRow}>
          <Artwork uri={album.artwork} size={64} />
          <View style={styles.trackMeta}>
            <Text numberOfLines={1} style={styles.trackTitle}>{album.title}</Text>
            <Text numberOfLines={1} style={styles.trackSub}>{album.artist} · {album.tracks.length} canciones · {album.local ? "local" : formatCount(album.downloads)}</Text>
          </View>
          <Pressable style={styles.smallButton} onPress={() => downloadAlbum(album)}>
            <Ionicons name="download" size={18} color="#071024" />
            <Text style={styles.smallButtonText}>Album</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[styles.sectionTitle, styles.albumTitle]}>Canciones</Text>
      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          item={track}
          active={current?.id === track.id}
          downloaded={isOffline(track)}
          inPlaylist={playlistIds.includes(track.id)}
          busy={busyId === track.id}
          onPress={() => play(track)}
          onDownload={() => downloadTrack(track)}
          onSave={() => togglePlaylist(track)}
        />
      ))}
    </ScrollView>
  );

  const renderLibrary = () => (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Mi playlist</Text>
      <View style={styles.playlistCard}>
        <View style={styles.trackMeta}>
          <Text style={styles.playlistName}>Emmanuel Premium</Text>
          <Text style={styles.trackSub}>{playlist.length} canciones · {playlist.filter(isOffline).length} offline</Text>
        </View>
        <Pressable style={[styles.downloadButton, allDownloaded && styles.downloadButtonDone]} onPress={downloadPlaylist}>
          <Ionicons name={allDownloaded ? "checkmark" : "download"} size={19} color="#071024" />
          <Text style={styles.downloadButtonText}>{allDownloaded ? "Offline" : "Descargar"}</Text>
        </Pressable>
      </View>
      {playlist.length ? playlist.map((track) => (
        <TrackRow
          key={track.id}
          item={track}
          active={current?.id === track.id}
          downloaded={isOffline(track)}
          inPlaylist
          busy={busyId === track.id}
          onPress={() => play(track)}
          onDownload={() => downloadTrack(track)}
          onSave={() => togglePlaylist(track)}
        />
      )) : <Text style={styles.emptyText}>Guarda canciones o descarga albumes desde Buscar.</Text>}
    </ScrollView>
  );

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.appName}>Emmanuel</Text>
            <Text style={styles.appSub}>Musica descargable sin anuncios</Text>
          </View>
          <View style={styles.headerActions}>
            <Ionicons name="cloud-offline-outline" size={23} color="#e8ebff" />
            <Image source={cover} style={styles.headerPhoto} />
          </View>
        </View>

        {tab === "home" && renderHome()}
        {tab === "search" && renderSearch()}
        {tab === "library" && renderLibrary()}

        <View style={styles.player}>
          <View style={styles.playerTop}>
            <Artwork uri={current?.artwork} size={64} />
            <View style={styles.trackMeta}>
              <Text numberOfLines={1} style={styles.nowTitle}>{current?.title || "Busca una cancion"}</Text>
              <Text numberOfLines={1} style={styles.trackSub}>{current?.artist || "Emmanuel Music"}</Text>
            </View>
            <Pressable onPress={() => current && downloadTrack(current)}>
              <Ionicons name={current && isOffline(current) ? "cloud-done" : "cloud-download-outline"} size={25} color="#ffffff" />
            </Pressable>
          </View>
          <View style={styles.progressRail}>
            <View style={styles.progressFill} />
          </View>
          <View style={styles.controls}>
            <Pressable onPress={() => setShuffle(!shuffle)}>
              <Ionicons name="shuffle" size={24} color={shuffle ? "#24e3a4" : "#d8dcff"} />
            </Pressable>
            <Pressable onPress={playNext}>
              <Ionicons name="play-skip-back" size={30} color="#ffffff" />
            </Pressable>
            <Pressable style={styles.playButton} onPress={togglePlay}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={34} color="#061023" />
            </Pressable>
            <Pressable onPress={playNext}>
              <Ionicons name="play-skip-forward" size={30} color="#ffffff" />
            </Pressable>
            <Pressable onPress={() => setRepeat(!repeat)}>
              <MaterialCommunityIcons name="repeat" size={25} color={repeat ? "#24e3a4" : "#d8dcff"} />
            </Pressable>
          </View>
        </View>

        <View style={styles.nav}>
          {[
            ["home", "Inicio", "home"],
            ["search", "Buscar", "search"],
            ["library", "Playlist", "library"]
          ].map(([key, label, icon]) => (
            <Pressable key={key} style={styles.navItem} onPress={() => setTab(key)}>
              <Ionicons name={tab === key ? icon : `${icon}-outline`} size={23} color={tab === key ? "#ffffff" : "#828bbb"} />
              <Text style={[styles.navText, tab === key && styles.navTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#050614", flex: 1 },
  safe: { flex: 1 },
  topBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10 },
  appName: { color: "#ffffff", fontSize: 30, fontWeight: "900" },
  appSub: { color: "#9aa3d4", fontSize: 13, marginTop: 2 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 14 },
  headerPhoto: { borderRadius: 20, height: 40, width: 40 },
  content: { paddingHorizontal: 18, paddingBottom: 240 },
  heroImage: { height: 330, marginTop: 8 },
  heroImageInner: { borderRadius: 8 },
  heroOverlay: { backgroundColor: "rgba(3,4,18,0.58)", borderRadius: 8, flex: 1, justifyContent: "flex-end", padding: 18 },
  brandRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  avatar: { borderColor: "rgba(255,255,255,0.45)", borderRadius: 22, borderWidth: 1, height: 44, width: 44 },
  brandLabel: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  brandSmall: { color: "#d5dcff", fontSize: 12 },
  heroTitle: { color: "#ffffff", fontSize: 31, fontWeight: "900", lineHeight: 36, marginTop: 16, maxWidth: 315 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 16 },
  pill: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.11)", borderColor: "rgba(255,255,255,0.10)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 7, paddingHorizontal: 12, paddingVertical: 9 },
  pillActive: { backgroundColor: "#394dff" },
  pillText: { color: "#ccd3ff", fontSize: 13, fontWeight: "800" },
  pillTextActive: { color: "#ffffff" },
  stats: { flexDirection: "row", gap: 10, marginVertical: 16 },
  stat: { backgroundColor: "rgba(255,255,255,0.08)", borderColor: "rgba(255,255,255,0.08)", borderRadius: 8, borderWidth: 1, flex: 1, padding: 12 },
  statValue: { color: "#ffffff", fontSize: 20, fontWeight: "900", marginTop: 8 },
  statLabel: { color: "#9aa3d4", fontSize: 12, marginTop: 2 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: "#ffffff", fontSize: 20, fontWeight: "900" },
  sectionAction: { color: "#24e3a4", fontSize: 12, fontWeight: "800", maxWidth: 180, textAlign: "right" },
  loader: { marginVertical: 18 },
  trackRow: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.07)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 9, padding: 10 },
  trackRowActive: { backgroundColor: "rgba(57,77,255,0.20)", borderColor: "rgba(110,127,255,0.50)" },
  artwork: { alignItems: "center", backgroundColor: "#12183d", borderRadius: 8, justifyContent: "center", overflow: "hidden" },
  artworkImage: { height: "100%", width: "100%" },
  trackMeta: { flex: 1, minWidth: 0 },
  trackTitle: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  trackSub: { color: "#9ba5d5", fontSize: 12, marginTop: 4 },
  duration: { color: "#aeb6e4", fontSize: 12, width: 38 },
  pageTitle: { color: "#ffffff", fontSize: 34, fontWeight: "900", marginTop: 8, marginBottom: 16 },
  searchBox: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.10)", borderColor: "rgba(255,255,255,0.09)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, marginBottom: 18, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { color: "#ffffff", flex: 1, fontSize: 16, minHeight: 34 },
  iconButton: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 8, height: 34, justifyContent: "center", width: 38 },
  albumTitle: { marginBottom: 10, marginTop: 16 },
  albumRow: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, flexDirection: "row", gap: 12, marginBottom: 10, padding: 10 },
  smallButton: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 8, flexDirection: "row", gap: 4, paddingHorizontal: 10, paddingVertical: 8 },
  smallButtonText: { color: "#071024", fontSize: 12, fontWeight: "900" },
  playlistCard: { alignItems: "center", backgroundColor: "rgba(57,77,255,0.18)", borderColor: "rgba(120,134,255,0.45)", borderRadius: 8, borderWidth: 1, flexDirection: "row", gap: 10, justifyContent: "space-between", marginBottom: 14, padding: 16 },
  playlistName: { color: "#ffffff", fontSize: 21, fontWeight: "900" },
  downloadButton: { alignItems: "center", backgroundColor: "#24e3a4", borderRadius: 8, flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 10 },
  downloadButtonDone: { backgroundColor: "#ffffff" },
  downloadButtonText: { color: "#071024", fontSize: 13, fontWeight: "900" },
  emptyText: { color: "#9ba5d5", fontSize: 15, marginTop: 12 },
  player: { borderColor: "rgba(255,255,255,0.10)", borderRadius: 8, borderWidth: 1, bottom: 82, left: 14, overflow: "hidden", padding: 14, position: "absolute", right: 14 },
  playerTop: { alignItems: "center", flexDirection: "row", gap: 12 },
  nowTitle: { color: "#ffffff", fontSize: 17, fontWeight: "900" },
  progressRail: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 4, height: 5, marginTop: 13, overflow: "hidden" },
  progressFill: { backgroundColor: "#ffffff", borderRadius: 4, height: 5, width: "38%" },
  controls: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingHorizontal: 4 },
  playButton: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 34, height: 62, justifyContent: "center", width: 62 },
  nav: { alignItems: "center", backgroundColor: "rgba(3,4,17,0.94)", borderColor: "rgba(255,255,255,0.08)", borderTopWidth: 1, bottom: 0, flexDirection: "row", height: 74, justifyContent: "space-around", left: 0, paddingBottom: 6, position: "absolute", right: 0 },
  navItem: { alignItems: "center", gap: 4, justifyContent: "center", minWidth: 82 },
  navText: { color: "#828bbb", fontSize: 12, fontWeight: "800" },
  navTextActive: { color: "#ffffff" }
});
