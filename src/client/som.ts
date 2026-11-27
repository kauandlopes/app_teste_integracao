/** Alerta de pedido novo gerado no navegador (sem arquivo de audio). Navegadores exigem um clique antes de tocar. */
let contexto: AudioContext | null = null;

export function liberarAudio() {
  contexto ??= new AudioContext();
  if (contexto.state === 'suspended') void contexto.resume();
}

export function tocarAlerta() {
  if (!contexto || contexto.state !== 'running') return;
  const inicio = contexto.currentTime;
  [880, 1175, 880].forEach((frequencia, i) => {
    const oscilador = contexto!.createOscillator();
    const volume = contexto!.createGain();
    oscilador.frequency.value = frequencia;
    volume.gain.setValueAtTime(0.25, inicio + i * 0.18);
    volume.gain.exponentialRampToValueAtTime(0.001, inicio + i * 0.18 + 0.15);
    oscilador.connect(volume).connect(contexto!.destination);
    oscilador.start(inicio + i * 0.18);
    oscilador.stop(inicio + i * 0.18 + 0.16);
  });
}
