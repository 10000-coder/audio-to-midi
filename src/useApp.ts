import { useState, useCallback, useRef } from 'react';
import type { AppState, StemState, StemStatus } from './types';
import { STEMS } from './types';
import {
  uploadAudio,
  createPrediction,
  pollUntilDone,
  getDownloadUrl,
} from './api';

export function useApp() {
  const [appState, setAppState] = useState<AppState>({
    step: 'idle',
    fileName: null,
    audioUri: null,
    stems: STEMS.map((s) => ({
      ...s,
      status: 'idle',
      audioUrl: null,
      midiUrl: null,
      midiFilename: null,
      error: null,
    })),
    logs: [],
  });

  const abortRef = useRef(false);

  const log = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setAppState((prev) => ({
      ...prev,
      logs: [...prev.logs, `[${time}] ${msg}`],
    }));
  }, []);

  const updateStem = useCallback((index: number, update: Partial<StemState>) => {
    setAppState((prev) => {
      const stems = [...prev.stems];
      stems[index] = { ...stems[index], ...update };
      return { ...prev, stems };
    });
  }, []);

  const updateAllStemsStatus = useCallback((status: StemStatus, extra?: Partial<StemState>) => {
    setAppState((prev) => ({
      ...prev,
      stems: prev.stems.map((s) => ({ ...s, ...extra, status })),
    }));
  }, []);

  // ====== Step 1: Upload ======
  const upload = useCallback(async (file: File) => {
    abortRef.current = false;
    setAppState((prev) => ({
      ...prev,
      step: 'uploading',
      fileName: file.name,
      logs: [],
    }));

    try {
      log(`📤 上传文件: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      const { uri } = await uploadAudio(file);
      if (abortRef.current) return;

      log('✅ 上传完成');
      setAppState((prev) => ({ ...prev, step: 'ready', audioUri: uri }));
    } catch (err: any) {
      log(`❌ 上传失败: ${err.message}`);
      setAppState((prev) => ({ ...prev, step: 'idle' }));
    }
  }, [log]);

  // ====== Step 2: Separate ======
  const separate = useCallback(async () => {
    abortRef.current = false;
    setAppState((prev) => ({ ...prev, step: 'separating' }));

    try {
      log('🎛️ 开始音轨分离 (Demucs htdemucs_6s)...');

      const prediction = await createPrediction('demucs', {
        audio: appState.audioUri,
      });
      if (abortRef.current) return;

      log(`⏳ 分离中... (prediction: ${prediction.id?.slice(0, 8)})`);

      const result = await pollUntilDone(prediction.id!, (status) => {
        if (status === 'processing') log('🔄 正在处理音频...');
      });
      if (abortRef.current) return;

      // Parse Demucs output: { drums: "url", bass: "url", ... }
      const output = result.output as Record<string, string> | undefined;
      if (!output) throw new Error('No output from separation');

      log('✅ 音轨分离完成！');

      // Map output URLs to stems
      setAppState((prev) => {
        const stems = prev.stems.map((stem) => {
          const url = output[stem.key];
          return {
            ...stem,
            status: (url ? 'separated' : 'idle') as StemStatus,
            audioUrl: url || stem.audioUrl,
            error: url ? null : `No output for ${stem.key}`,
          };
        });
        return { ...prev, stems, step: 'separated' };
      });
    } catch (err: any) {
      log(`❌ 分离失败: ${err.message}`);
      setAppState((prev) => ({ ...prev, step: 'ready' }));
    }
  }, [appState.audioUri, log]);

  // ====== Step 3: Transcribe single stem ======
  const transcribeStem = useCallback(async (index: number) => {
    const stem = appState.stems[index];
    if (!stem.audioUrl) return;

    updateStem(index, { status: 'transcribing', error: null });
    log(`🎵 转录 ${stem.label} (${stem.key})...`);

    try {
      const prediction = await createPrediction('basic-pitch', {
        audio_file: stem.audioUrl,
      });
      if (abortRef.current) return;

      const result = await pollUntilDone(
        prediction.id!,
        (status) => {
          if (status === 'processing') log(`  🔄 ${stem.label} 转录中...`);
        },
        300_000,
        2000
      );
      if (abortRef.current) return;

      // Basic Pitch returns output as a URL string
      const midiUrl = typeof result.output === 'string'
        ? result.output
        : (result.output as any)?.output;

      if (!midiUrl) throw new Error('No MIDI output');

      log(`✅ ${stem.label} 转录完成`);

      updateStem(index, {
        status: 'done',
        midiUrl,
        midiFilename: `${stem.key}.mid`,
      });
    } catch (err: any) {
      log(`❌ ${stem.label} 转录失败: ${err.message}`);
      updateStem(index, { status: 'separated', error: err.message });
    }
  }, [appState.stems, log, updateStem]);

  // ====== Step 3: Transcribe ALL stems ======
  const transcribeAll = useCallback(async () => {
    abortRef.current = false;
    setAppState((prev) => ({ ...prev, step: 'transcribing' }));
    updateAllStemsStatus('transcribing');

    log('🎵 开始批量转录所有音轨...');
    log('⚠️ 注意：Basic Pitch 对非旋律乐器（鼓）效果有限');

    // Transcribe sequentially to avoid rate limits
    for (let i = 0; i < appState.stems.length; i++) {
      if (abortRef.current) break;
      const stem = appState.stems[i];
      if (!stem.audioUrl || stem.status === 'done') continue;

      await transcribeStem(i);
    }

    // Update final step
    setAppState((prev) => {
      const allDone = prev.stems.every(
        (s) => s.status === 'done' || s.status === 'error'
      );
      return {
        ...prev,
        step: allDone ? 'complete' : 'transcribing',
      };
    });
  }, [appState.stems, transcribeStem, log, updateAllStemsStatus]);

  // ====== Reset ======
  const reset = useCallback(() => {
    abortRef.current = true;
    setAppState({
      step: 'idle',
      fileName: null,
      audioUri: null,
      stems: STEMS.map((s) => ({
        ...s,
        status: 'idle',
        audioUrl: null,
        midiUrl: null,
        midiFilename: null,
        error: null,
      })),
      logs: [],
    });
  }, []);

  return {
    ...appState,
    upload,
    separate,
    transcribeStem,
    transcribeAll,
    reset,
    getMidiDownloadUrl: getDownloadUrl,
    getStemDownloadUrl: getDownloadUrl,
  };
}
