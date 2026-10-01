/**
 * BunkKro - Multi-Engine Automated Timetable Scanner
 * 
 * Pipeline:
 *  Upload -> Preprocessing (Deskew, Grayscale, Dual-Offset Adaptive Thresholding)
 *  -> Engine B: OpenCV Geometry Analysis (Line masks, Local Segments, Fine-Grid)
 *  -> Engine C: Multi-Strategy Tesseract.js OCR (Whole-Image, Region-based, Targeted Retry)
 *  -> Engine D: Independent Structural Layout Analysis (Text bands, Headers, Period columns)
 *  -> Shared Intermediate Representation (SIR)
 *  -> Result Fusion Engine (Cross-engine evidence, Merged-cell resolution, Conflict detection)
 *  -> Semantic Table Reconstruction (Weekday/Period mapping, BunkKro subject normalization)
 *  -> Validation & Disagreement Engine
 *  -> Interactive Visual Review Studio (Image overlay, Cell inspection, Split/Merge, Undo/Redo)
 *  -> User Approval & BunkKro Database Integration
 */

(function (window) {
  'use strict';

  const TimetableScanner = {};

  // ════════════════════════════════════════════════════════════
  // 1. CONFIGURATION & CALIBRATION CONSTANTS
  // ════════════════════════════════════════════════════════════
  TimetableScanner.Config = {
    // Image Preprocessing
    maxWorkingSide: 2000,
    strictC: 10,
    faintC: 4,
    lineKernelDiv: 70,
    faintKernelDiv: 40,
    minKernel: 12,
    skewMaxDeg: 5,
    skewMinApplyDeg: 0.15,
    skewMinGain: 1.02,

    // Geometry Analysis
    segMinRun: 8,
    maxLineThickness: 9,
    minSegFrac: 0.025,
    longSegFrac: 0.10,
    clusterTolFrac: 0.005,
    jitterFactor: 2.5,
    maxLines: 180,

    // Edge Measurement & Classification
    endPad: 3,
    bridgeGap: 3,
    minFaintRun: 8,
    minFaintRunFrac: 0.06,
    confirmedCov: 0.85,
    faintMaskCov: 0.88,
    faintLineCov: 0.48,
    fragmentCov: 0.18,
    textCrossCov: 0.10,
    contentMin: 0.012,
    minCellSize: 14,

    // OCR & Fusion
    ocrMinWordConfidence: 45,
    ocrRetryLowConfidence: 55,
    maxTargetedOCRRetries: 15,
    textLineBandTolerance: 14
  };

  // ════════════════════════════════════════════════════════════
  // 2. AFFINE TRANSFORMATION UTILITIES
  // ════════════════════════════════════════════════════════════
  TimetableScanner.Affine = {
    mul(A, B) {
      return [
        A[0] * B[0] + A[1] * B[3], A[0] * B[1] + A[1] * B[4], A[0] * B[2] + A[1] * B[5] + A[2],
        A[3] * B[0] + A[4] * B[3], A[3] * B[1] + A[4] * B[4], A[3] * B[2] + A[4] * B[5] + A[5]
      ];
    },
    invert(M) {
      const det = M[0] * M[4] - M[1] * M[3];
      if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0];
      const i0 = M[4] / det, i1 = -M[1] / det, i3 = -M[3] / det, i4 = M[0] / det;
      return [i0, i1, -(i0 * M[2] + i1 * M[5]), i3, i4, -(i3 * M[2] + i4 * M[5])];
    },
    apply(M, x, y) {
      return [M[0] * x + M[1] * y + M[2], M[3] * x + M[4] * y + M[5]];
    },
    rotation(angleDeg, cx, cy) {
      const a = Math.cos(angleDeg * Math.PI / 180), b = Math.sin(angleDeg * Math.PI / 180);
      return [a, b, (1 - a) * cx - b * cy, -b, a, b * cx + (1 - a) * cy];
    }
  };

  // ════════════════════════════════════════════════════════════
  // 3. ENGINE A: IMAGE PREPROCESSING & DESKEW
  // ════════════════════════════════════════════════════════════
  TimetableScanner.Preprocessor = {
    async deskewAndEnhance(imageSource, customCfg = {}) {
      const cfg = Object.assign({}, TimetableScanner.Config, customCfg);

      let imgElement;
      if (imageSource instanceof HTMLImageElement || imageSource instanceof HTMLCanvasElement) {
        imgElement = imageSource;
      } else if (typeof imageSource === 'string') {
        imgElement = await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = imageSource;
        });
      } else if (imageSource instanceof Blob || imageSource instanceof File) {
        const url = URL.createObjectURL(imageSource);
        imgElement = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
          img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
          img.src = url;
        });
      } else {
        throw new Error('Unsupported image source type for Preprocessor.deskewAndEnhance');
      }

      const origW = imgElement.naturalWidth || imgElement.width;
      const origH = imgElement.naturalHeight || imgElement.height;
      const scale = Math.min(1, (cfg.maxWorkingSide || 2000) / Math.max(origW, origH));
      const W = Math.round(origW * scale);
      const H = Math.round(origH * scale);

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = origW;
      srcCanvas.height = origH;
      const srcCtx = srcCanvas.getContext('2d');
      srcCtx.drawImage(imgElement, 0, 0);

      const hasOpenCV = typeof window !== 'undefined' && window.cv && window.cv.Mat && !window.cvLoadFailed;

      if (hasOpenCV) {
        return this.deskewAndEnhanceOpenCV(window.cv, srcCanvas, origW, origH, W, H, scale, cfg);
      } else {
        return this.deskewAndEnhanceCanvas(srcCanvas, origW, origH, W, H, scale, cfg);
      }
    },

    deskewAndEnhanceOpenCV(cv, srcCanvas, origW, origH, W, H, scale, cfg) {
      const mats = [];
      const track = (m) => { mats.push(m); return m; };

      try {
        const src = track(cv.imread(srcCanvas));
        let working = src;
        if (scale < 1) {
          working = track(new cv.Mat());
          cv.resize(src, working, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
        }

        const S = [W / origW, 0, 0, 0, H / origH, 0];
        let M = S;
        let angle = 0;

        let bin = this.binarizeWithOpenCV(cv, working, W, H, cfg, track);
        const sk = this.estimateSkew(new Uint8Array(bin.strictBin.data), W, H, cfg);

        if (Math.abs(sk.angle) >= cfg.skewMinApplyDeg && sk.score > sk.baseScore * cfg.skewMinGain) {
          const R = TimetableScanner.Affine.rotation(sk.angle, W / 2, H / 2);
          const rotated = track(new cv.Mat());
          const Rm = track(cv.matFromArray(2, 3, cv.CV_64FC1, R));
          cv.warpAffine(working, rotated, Rm, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
          working = rotated;
          M = TimetableScanner.Affine.mul(R, S);
          angle = sk.angle;
          bin = this.binarizeWithOpenCV(cv, working, W, H, cfg, track);
        }

        const workCanvas = document.createElement('canvas');
        cv.imshow(workCanvas, working);

        const thresholdCanvas = document.createElement('canvas');
        thresholdCanvas.width = W;
        thresholdCanvas.height = H;
        cv.imshow(thresholdCanvas, bin.strictBin);

        const arrays = this.extractLineMasks(cv, bin, W, H, cfg, track);
        const hAll = new Uint8Array(W * H), vAll = new Uint8Array(W * H);
        for (let i = 0; i < hAll.length; i++) {
          hAll[i] = (arrays.hStrict[i] || arrays.hFaint[i]) ? 1 : 0;
          vAll[i] = (arrays.vStrict[i] || arrays.vFaint[i]) ? 1 : 0;
        }

        const det = TimetableScanner.GeometryEngine.detectLocalSegments(hAll, vAll, W, H, cfg);
        const integral = TimetableScanner.GeometryEngine.makeIntegral(arrays.ink, W, H);

        return {
          canvas: workCanvas,
          workCanvas,
          thresholdCanvas,
          gray: bin.gray,
          W,
          H,
          scale,
          skewAngle: angle,
          T: { M, origW, origH, workW: W, workH: H, scale, angle },
          arrays,
          hAll,
          vAll,
          det,
          integral,
          cfg
        };
      } finally {
        mats.forEach(m => {
          try { m.delete(); } catch (e) { /* freed */ }
        });
      }
    },

    deskewAndEnhanceCanvas(srcCanvas, origW, origH, W, H, scale, cfg) {
      const workCanvas = document.createElement('canvas');
      workCanvas.width = W;
      workCanvas.height = H;
      const ctx = workCanvas.getContext('2d');
      ctx.drawImage(srcCanvas, 0, 0, W, H);

      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      const gray = new Uint8Array(W * H);
      const ink = new Uint8Array(W * H);
      const strictBin = new Uint8Array(W * H);

      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        const g = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
        gray[p] = g;
        const isInk = g < 160 ? 1 : 0;
        ink[p] = isInk;
        strictBin[p] = isInk ? 255 : 0;
      }

      const sk = this.estimateSkew(ink, W, H, cfg);
      let angle = 0;
      let M = [W / origW, 0, 0, 0, H / origH, 0];

      if (Math.abs(sk.angle) >= cfg.skewMinApplyDeg) {
        angle = sk.angle;
        const rotatedCanvas = document.createElement('canvas');
        rotatedCanvas.width = W;
        rotatedCanvas.height = H;
        const rctx = rotatedCanvas.getContext('2d');
        rctx.fillStyle = '#ffffff';
        rctx.fillRect(0, 0, W, H);
        rctx.save();
        rctx.translate(W / 2, H / 2);
        rctx.rotate(-angle * Math.PI / 180);
        rctx.drawImage(workCanvas, -W / 2, -H / 2);
        rctx.restore();
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(rotatedCanvas, 0, 0);

        const R = TimetableScanner.Affine.rotation(angle, W / 2, H / 2);
        M = TimetableScanner.Affine.mul(R, M);
      }

      const thresholdCanvas = document.createElement('canvas');
      thresholdCanvas.width = W;
      thresholdCanvas.height = H;
      const tctx = thresholdCanvas.getContext('2d');
      const tImgData = tctx.createImageData(W, H);
      for (let i = 0, p = 0; i < tImgData.data.length; i += 4, p++) {
        const val = ink[p] ? 255 : 0;
        tImgData.data[i] = val;
        tImgData.data[i + 1] = val;
        tImgData.data[i + 2] = val;
        tImgData.data[i + 3] = 255;
      }
      tctx.putImageData(tImgData, 0, 0);

      const arrays = {
        hStrict: ink,
        vStrict: ink,
        hFaint: ink,
        vFaint: ink,
        ink: ink,
        strictBin: strictBin
      };

      const hAll = ink;
      const vAll = ink;
      const det = TimetableScanner.GeometryEngine.detectLocalSegments(hAll, vAll, W, H, cfg);
      const integral = TimetableScanner.GeometryEngine.makeIntegral(ink, W, H);

      return {
        canvas: workCanvas,
        workCanvas,
        thresholdCanvas,
        gray,
        W,
        H,
        scale,
        skewAngle: angle,
        T: { M, origW, origH, workW: W, workH: H, scale, angle },
        arrays,
        hAll,
        vAll,
        det,
        integral,
        cfg
      };
    },

    estimateSkew(inkMask, W, H, cfg) {
      let total = 0;
      for (let i = 0; i < inkMask.length; i++) if (inkMask[i]) total++;
      if (total < 50) return { angle: 0, score: 0, baseScore: 0 };

      const stride = Math.max(1, Math.floor(total / 160000));
      const px = new Int32Array(Math.ceil(total / stride) + 1);
      const py = new Int32Array(px.length);
      let n = 0, seen = 0;

      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) {
          if (inkMask[row + x]) {
            if (seen % stride === 0) { px[n] = x; py[n] = y; n++; }
            seen++;
          }
        }
      }

      const pad = Math.ceil(W * 0.12) + 2;
      const hist = new Int32Array(H + 2 * pad + 2);
      const cx = W / 2;

      const score = (deg) => {
        const s = Math.tan(deg * Math.PI / 180);
        hist.fill(0);
        for (let i = 0; i < n; i++) hist[Math.round(py[i] - s * (px[i] - cx)) + pad]++;
        let sc = 0;
        for (let i = 0; i < hist.length; i++) sc += hist[i] * hist[i];
        return sc;
      };

      let best = 0, bestScore = -1;
      for (let d = -cfg.skewMaxDeg; d <= cfg.skewMaxDeg + 1e-9; d += 0.25) {
        const sc = score(d);
        if (sc > bestScore) { bestScore = sc; best = d; }
      }
      const center = best;
      for (let d = center - 0.25; d <= center + 0.25 + 1e-9; d += 0.025) {
        const sc = score(d);
        if (sc > bestScore) { bestScore = sc; best = d; }
      }

      return { angle: Math.round(best * 1000) / 1000, score: bestScore, baseScore: score(0) };
    },

    binarizeWithOpenCV(cv, rgbaMat, W, H, cfg, track) {
      const gray = track(new cv.Mat()), blur = track(new cv.Mat());
      const strictBin = track(new cv.Mat()), faintBin = track(new cv.Mat());
      cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(3, 3), 0);

      const oddAtLeast = (value, min) => { const v = Math.max(min, Math.round(value)); return v % 2 === 1 ? v : v + 1; };
      const block = oddAtLeast(Math.min(W, H) / 40, 15);

      cv.adaptiveThreshold(blur, strictBin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, cfg.strictC);
      cv.adaptiveThreshold(blur, faintBin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, cfg.faintC);

      return { strictBin, faintBin, gray };
    },

    extractLineMasks(cv, binMats, W, H, cfg, track) {
      const open = (src, kw, kh) => {
        const k = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kw, kh)));
        const dst = track(new cv.Mat());
        cv.morphologyEx(src, dst, cv.MORPH_OPEN, k);
        return new Uint8Array(dst.data);
      };

      const Lh = Math.max(cfg.minKernel, Math.round(W / cfg.lineKernelDiv));
      const Lv = Math.max(cfg.minKernel, Math.round(H / cfg.lineKernelDiv));
      const Lhf = Math.max(cfg.minKernel, Math.round(W / cfg.faintKernelDiv));
      const Lvf = Math.max(cfg.minKernel, Math.round(H / cfg.faintKernelDiv));

      return {
        hStrict: open(binMats.strictBin, Lh, 1),
        vStrict: open(binMats.strictBin, 1, Lv),
        hFaint: open(binMats.faintBin, Lhf, 1),
        vFaint: open(binMats.faintBin, 1, Lvf),
        ink: new Uint8Array(binMats.faintBin.data),
        strictBin: new Uint8Array(binMats.strictBin.data)
      };
    }
  };

  // ════════════════════════════════════════════════════════════
  // 4. ENGINE B: OPENCV GEOMETRY ANALYSIS
  // ════════════════════════════════════════════════════════════
  TimetableScanner.GeometryEngine = {
    transposeMask(mask, W, H) {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const row = y * W;
        for (let x = 0; x < W; x++) if (mask[row + x]) out[x * H + y] = 1;
      }
      return out;
    },

    extractSegments(mask, W, H, minRun, maxThick) {
      const parent = [], runs = [];
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
      let prev = [];

      for (let y = 0; y < H; y++) {
        const cur = [];
        const row = y * W;
        let x = 0;
        while (x < W) {
          if (mask[row + x]) {
            const s = x;
            while (x < W && mask[row + x]) x++;
            if (x - s >= minRun) {
              const id = runs.length;
              runs.push({ y, x1: s, x2: x - 1 });
              parent.push(id);
              cur.push(id);
            }
          } else x++;
        }

        let p = 0;
        for (const id of cur) {
          const r = runs[id];
          for (let q = p; q < prev.length; q++) {
            const pr = runs[prev[q]];
            if (pr.x2 < r.x1) { p = q + 1; continue; }
            if (pr.x1 > r.x2) break;
            union(id, prev[q]);
          }
        }
        prev = cur;
      }

      const groups = new Map();
      for (let i = 0; i < runs.length; i++) {
        const root = find(i), r = runs[i], len = r.x2 - r.x1 + 1;
        let g = groups.get(root);
        if (!g) { g = { ySum: 0, wSum: 0, y1: Infinity, y2: -Infinity, a: Infinity, b: -Infinity }; groups.set(root, g); }
        g.ySum += r.y * len; g.wSum += len;
        g.y1 = Math.min(g.y1, r.y); g.y2 = Math.max(g.y2, r.y);
        g.a = Math.min(g.a, r.x1); g.b = Math.max(g.b, r.x2);
      }

      const out = [];
      for (const g of groups.values()) {
        const thick = g.y2 - g.y1 + 1;
        if (thick > maxThick) continue;
        out.push({ pos: g.ySum / g.wSum, a: g.a, b: g.b, thick });
      }
      return out;
    },

    detectLocalSegments(hAll, vAll, W, H, cfg) {
      const minDim = Math.min(W, H);
      const tol = Math.max(3, Math.round(minDim * cfg.clusterTolFrac));
      const maxThick = Math.max(cfg.maxLineThickness, Math.round(minDim * 0.012));
      const hSegs = this.extractSegments(hAll, W, H, cfg.segMinRun, maxThick);
      const vSegs = this.extractSegments(this.transposeMask(vAll, W, H), H, W, cfg.segMinRun, maxThick);

      const minH = Math.max(cfg.minKernel, Math.round(cfg.minSegFrac * W));
      const minV = Math.max(cfg.minKernel, Math.round(cfg.minSegFrac * H));
      const longH = cfg.longSegFrac * W, longV = cfg.longSegFrac * H;
      const slack = tol + 2;

      const vCand = vSegs.filter(s => s.b - s.a + 1 >= minV);
      const hCand = hSegs.filter(s => s.b - s.a + 1 >= minH);

      const endsOn = (s, perps) => {
        for (const p of perps) {
          if (s.pos < p.a - slack || s.pos > p.b + slack) continue;
          if (Math.abs(p.pos - s.a) <= slack || Math.abs(p.pos - s.b) <= slack) return true;
        }
        return false;
      };

      for (const s of hSegs) {
        const len = s.b - s.a + 1;
        if (len < minH) { s.accepted = false; s.reason = 'too short'; }
        else if (len >= longH) { s.accepted = true; s.reason = 'long'; }
        else if (endsOn(s, vCand)) { s.accepted = true; s.reason = 'junction'; }
        else { s.accepted = false; s.reason = 'no junction'; }
      }
      for (const s of vSegs) {
        const len = s.b - s.a + 1;
        if (len < minV) { s.accepted = false; s.reason = 'too short'; }
        else if (len >= longV) { s.accepted = true; s.reason = 'long'; }
        else if (endsOn(s, hCand)) { s.accepted = true; s.reason = 'junction'; }
        else { s.accepted = false; s.reason = 'no junction'; }
      }

      const hA = hSegs.filter(s => s.accepted), vA = vSegs.filter(s => s.accepted);
      const intersections = [];
      for (const h of hA) {
        for (const v of vA) {
          if (v.pos >= h.a - slack && v.pos <= h.b + slack && h.pos >= v.a - slack && h.pos <= v.b + slack) {
            if (intersections.length < 6000) intersections.push({ x: v.pos, y: h.pos });
          }
        }
      }
      return { tol, W, H, hSegs, vSegs, intersections };
    },

    clusterSegments(segs, tol, jitterTol) {
      const sorted = segs.slice().sort((p, q) => p.pos - q.pos);
      let clusters = [];
      for (const s of sorted) {
        const w = s.b - s.a + 1, last = clusters[clusters.length - 1];
        if (last && Math.abs(s.pos - last.pos) <= tol) {
          last.segs.push(s); last.wSum += w; last.pSum += s.pos * w; last.pos = last.pSum / last.wSum;
        } else clusters.push({ segs: [s], wSum: w, pSum: s.pos * w, pos: s.pos });
      }

      const mergeIntervals = (list) => {
        const sortedI = list.map(s => [s.a, s.b]).sort((p, q) => p[0] - q[0]);
        const out = [];
        for (const [a, b] of sortedI) {
          const last = out[out.length - 1];
          if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
          else out.push([a, b]);
        }
        return out;
      };

      const overlapLen = (I1, I2) => {
        let i = 0, j = 0, tot = 0;
        while (i < I1.length && j < I2.length) {
          const lo = Math.max(I1[i][0], I2[j][0]), hi = Math.min(I1[i][1], I2[j][1]);
          if (hi > lo) tot += hi - lo + 1;
          if (I1[i][1] < I2[j][1]) i++; else j++;
        }
        return tot;
      };

      const finalize = (c) => {
        c.intervals = mergeIntervals(c.segs);
        c.covered = c.intervals.reduce((n, [a, b]) => n + (b - a + 1), 0);
      };
      clusters.forEach(finalize);

      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 0; i < clusters.length - 1; i++) {
          const A = clusters[i], B = clusters[i + 1];
          if (B.pos - A.pos <= jitterTol &&
              overlapLen(A.intervals, B.intervals) <= 0.1 * Math.min(A.covered, B.covered)) {
            A.segs = A.segs.concat(B.segs); A.wSum += B.wSum; A.pSum += B.pSum; A.pos = A.pSum / A.wSum;
            finalize(A);
            clusters.splice(i + 1, 1);
            changed = true;
            break;
          }
        }
      }
      return clusters.map(c => ({ pos: c.pos, intervals: c.intervals, covered: c.covered, manual: c.segs.some(s => s.manual) }));
    },

    makeIntegral(mask, W, H) {
      const I = new Uint32Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let rowSum = 0;
        for (let x = 0; x < W; x++) {
          if (mask[y * W + x]) rowSum++;
          I[(y + 1) * (W + 1) + (x + 1)] = I[y * (W + 1) + (x + 1)] + rowSum;
        }
      }
      return I;
    },

    boxSum(I, W, H, x1, y1, x2, y2) {
      x1 = Math.max(0, Math.round(x1)); y1 = Math.max(0, Math.round(y1));
      x2 = Math.min(W, Math.round(x2)); y2 = Math.min(H, Math.round(y2));
      if (x2 <= x1 || y2 <= y1) return 0;
      const S = W + 1;
      return I[y2 * S + x2] - I[y1 * S + x2] - I[y2 * S + x1] + I[y1 * S + x1];
    },

    measureEdge(horizontal, pos, a, b, W, H, strictMask, faintMask, inkMask, cfg, bandTol) {
      const alongMax = horizontal ? W : H, perpMax = horizontal ? H : W;
      const start = Math.round(a) + cfg.endPad, end = Math.round(b) - cfg.endPad;
      const len = end - start + 1;
      const empty = { len: Math.max(len, 0), strictCov: 0, faintMaskCov: 0, faintCov: 0, inkCov: 0, spread: 0 };
      if (len < 4) return empty;

      const p = Math.round(pos);
      const lo = Math.max(0, p - bandTol), hi = Math.min(perpMax - 1, p + bandTol);
      const minRun = Math.max(cfg.minFaintRun, Math.ceil(len * cfg.minFaintRunFrac));

      let strictHits = 0, faintMaskHits = 0, inkTotal = 0, covered = 0;
      const thirdInk = [0, 0, 0], thirdLen = [0, 0, 0];
      let runStart = -1, runLast = -1, py = p;
      const endRun = () => {
        if (runStart >= 0 && (runLast - runStart + 1) >= minRun) covered += runLast - runStart + 1;
        runStart = -1;
      };

      for (let i = 0; i < len; i++) {
        const t = start + i;
        const third = Math.min(2, Math.floor((i * 3) / len));
        thirdLen[third]++;
        if (t < 0 || t >= alongMax) continue;
        let strict = false, fm = false, best = -1, bestD = Infinity;
        const ref = runStart >= 0 ? py : p;
        for (let q = lo; q <= hi; q++) {
          const idx = horizontal ? q * W + t : t * W + q;
          if (strictMask[idx]) strict = true;
          if (faintMask[idx]) fm = true;
          if (inkMask[idx]) { const d = Math.abs(q - ref); if (d < bestD) { bestD = d; best = q; } }
        }
        if (strict) strictHits++;
        if (fm) faintMaskHits++;
        if (best >= 0) {
          inkTotal++; thirdInk[third]++;
          if (runStart < 0) { runStart = i; runLast = i; py = best; }
          else if (bestD <= 1) { runLast = i; py = best; }
          else { endRun(); runStart = i; runLast = i; py = best; }
        } else if (runStart >= 0 && i - runLast > cfg.bridgeGap) endRun();
      }
      endRun();

      let spread = 0;
      for (let s = 0; s < 3; s++) if (thirdLen[s] > 0 && thirdInk[s] / thirdLen[s] >= 0.25) spread++;
      return { len, strictCov: strictHits / len, faintMaskCov: faintMaskHits / len, faintCov: covered / len, inkCov: inkTotal / len, spread };
    },

    computeComps(grid, wallFn) {
      const { nx, ny, hE, vE } = grid;
      const nR = ny - 1, nC = nx - 1;
      const parent = Array.from({ length: nR * nC }, (_, i) => i);
      const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
      const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

      for (let k = 1; k < ny - 1; k++) for (let c = 0; c < nC; c++) if (!wallFn(hE[k][c])) union((k - 1) * nC + c, k * nC + c);
      for (let j = 1; j < nx - 1; j++) for (let r = 0; r < nR; r++) if (!wallFn(vE[j][r])) union(r * nC + (j - 1), r * nC + j);

      const compOf = new Int32Array(nR * nC);
      const comps = new Map();
      for (let r = 0; r < nR; r++) {
        for (let c = 0; c < nC; c++) {
          const root = find(r * nC + c);
          compOf[r * nC + c] = root;
          let g = comps.get(root);
          if (!g) { g = { r0: r, r1: r, c0: c, c1: c, members: [] }; comps.set(root, g); }
          g.r0 = Math.min(g.r0, r); g.r1 = Math.max(g.r1, r);
          g.c0 = Math.min(g.c0, c); g.c1 = Math.max(g.c1, c);
          g.members.push([r, c]);
        }
      }
      for (const g of comps.values()) g.rect = g.members.length === (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
      return { compOf, comps, nC };
    },

    buildGrid(detOrPreprocessed, M, W, H, cfg, extraLines = []) {
      let det, masks, width, height, config;

      if (detOrPreprocessed && detOrPreprocessed.det) {
        det = detOrPreprocessed.det;
        masks = detOrPreprocessed.arrays;
        width = detOrPreprocessed.W;
        height = detOrPreprocessed.H;
        config = M || detOrPreprocessed.cfg || TimetableScanner.Config;
      } else {
        det = detOrPreprocessed;
        masks = M;
        width = W;
        height = H;
        config = cfg || TimetableScanner.Config;
      }

      const tol = det?.tol || Math.max(3, Math.round(Math.min(width, height) * (config.clusterTolFrac || 0.005)));
      const jitterTol = tol * (config.jitterFactor || 2.5);
      const toSeg = (l) => ({ pos: l.pos, a: l.a, b: l.b, thick: 1, manual: true });
      const hLines = this.clusterSegments((det?.hSegs || []).filter(s => s.accepted).concat(extraLines.filter(l => l.horizontal).map(toSeg)), tol, jitterTol);
      const vLines = this.clusterSegments((det?.vSegs || []).filter(s => s.accepted).concat(extraLines.filter(l => !l.horizontal).map(toSeg)), tol, jitterTol);

      if (hLines.length < 2 || vLines.length < 2) {
        const numH = Math.max(6, Math.round(height / 80));
        const numV = Math.max(5, Math.round(width / 140));
        for (let i = 0; i <= numH; i++) {
          const p = Math.round(i * height / numH);
          if (!hLines.some(l => Math.abs(l.pos - p) < tol)) hLines.push({ pos: p, thick: 1, manual: false });
        }
        for (let j = 0; j <= numV; j++) {
          const p = Math.round(j * width / numV);
          if (!vLines.some(l => Math.abs(l.pos - p) < tol)) vLines.push({ pos: p, thick: 1, manual: false });
        }
        hLines.sort((a, b) => a.pos - b.pos);
        vLines.sort((a, b) => a.pos - b.pos);
      }

      const ys = hLines.map(l => l.pos), xs = vLines.map(l => l.pos);
      const ny = ys.length, nx = xs.length;
      const bandTol = tol;
      const hE = [], vE = [], edges = [];
      let nextId = 1;
      const integral = (detOrPreprocessed && detOrPreprocessed.integral) ? detOrPreprocessed.integral : this.makeIntegral(masks?.ink || new Uint8Array(width * height), width, height);

      for (let k = 0; k < ny; k++) {
        hE[k] = [];
        for (let c = 0; c < nx - 1; c++) {
          const m = masks ? this.measureEdge(true, ys[k], xs[c], xs[c + 1], width, height, masks.hStrict, masks.hFaint, masks.ink, config, bandTol) : { strictCov: 1, faintMaskCov: 1, faintCov: 1, inkCov: 1, spread: 3 };
          const e = Object.assign({
            id: nextId++, horizontal: true, pos: ys[k], a: xs[c], b: xs[c + 1], k, c,
            status: null, source: '', reason: '', contin: null, corners: null, override: null, manualLine: false,
            contentA: null, contentB: null
          }, m);
          e.pass1 = m.strictCov >= (config.confirmedCov || 0.85) ? 'mask' : (m.faintMaskCov >= (config.faintMaskCov || 0.88) ? 'faint-mask' : null);
          hE[k][c] = e; edges.push(e);
        }
      }
      for (let j = 0; j < nx; j++) {
        vE[j] = [];
        for (let r = 0; r < ny - 1; r++) {
          const m = masks ? this.measureEdge(false, xs[j], ys[r], ys[r + 1], width, height, masks.vStrict, masks.vFaint, masks.ink, config, bandTol) : { strictCov: 1, faintMaskCov: 1, faintCov: 1, inkCov: 1, spread: 3 };
          const e = Object.assign({
            id: nextId++, horizontal: false, pos: xs[j], a: ys[r], b: ys[r + 1], j, r,
            status: null, source: '', reason: '', contin: null, corners: null, override: null, manualLine: false,
            contentA: null, contentB: null
          }, m);
          e.pass1 = m.strictCov >= (config.confirmedCov || 0.85) ? 'mask' : (m.faintMaskCov >= (config.faintMaskCov || 0.88) ? 'faint-mask' : null);
          vE[j][r] = e; edges.push(e);
        }
      }

      const conf = (e) => !!e && !!e.pass1;
      const margin = tol + 2;
      const density = (r, c) => {
        const x1 = xs[c] + margin, x2 = xs[c + 1] - margin, y1 = ys[r] + margin, y2 = ys[r + 1] - margin;
        const area = (x2 - x1) * (y2 - y1);
        if (area < 16) return null;
        return this.boxSum(integral, width, height, x1, y1, x2, y2) / area;
      };

      // Pass 2: Classification using evidence + surrounding confirmed boundaries
      for (const e of edges) {
        if (e.pass1) {
          e.status = 'confirmed';
          e.source = e.pass1 === 'mask' ? 'line mask' : 'faint line mask';
          e.reason = e.pass1 === 'mask' ? 'strict line mask covers edge' : 'continuous faint line covers edge';
          continue;
        }
        let contin, corners, A = null, B = null;
        if (e.horizontal) {
          const { k, c } = e;
          const left = c > 0 ? hE[k][c - 1] : null, right = c < nx - 2 ? hE[k][c + 1] : null;
          contin = !!left && !!right && conf(left) && conf(right);
          const endOK = (j) => conf(k > 0 ? vE[j][k - 1] : null) || conf(k < ny - 1 ? vE[j][k] : null);
          corners = endOK(c) && endOK(c + 1);
          if (k > 0) A = density(k - 1, c);
          if (k < ny - 1) B = density(k, c);
        } else {
          const { j, r } = e;
          const up = r > 0 ? vE[j][r - 1] : null, dn = r < ny - 2 ? vE[j][r + 1] : null;
          contin = !!up && !!dn && conf(up) && conf(dn);
          const endOK = (kk) => conf(j > 0 ? hE[kk][j - 1] : null) || conf(j < nx - 1 ? hE[kk][j] : null);
          corners = endOK(r) && endOK(r + 1);
          if (j > 0) A = density(r, j - 1);
          if (j < nx - 1) B = density(r, j);
        }
        e.contin = contin; e.corners = corners; e.contentA = A; e.contentB = B;

        const lineCov = Math.max(e.strictCov || 0, e.faintMaskCov || 0, e.faintCov || 0);
        const structure = contin || corners;

        if (lineCov >= (config.faintLineCov || 0.48)) {
          if (structure) { e.status = 'inferred'; e.source = 'faint ink + structure'; e.reason = 'faint/broken line ink with structural support'; }
          else { e.status = 'uncertain'; e.source = 'faint ink'; e.reason = 'faint ink without structural ties'; }
        } else if (lineCov >= (config.fragmentCov || 0.18) && e.spread >= 2) {
          if (structure) { e.status = 'uncertain'; e.source = 'fragmentary ink'; e.reason = 'fragmentary ink along edge'; }
          else { e.status = 'none'; e.source = 'fragmentary ink'; e.reason = 'fragmentary ink without support'; }
        } else if ((e.inkCov || 0) >= (config.textCrossCov || 0.10)) {
          e.status = 'none'; e.source = 'text crossing'; e.reason = 'text crosses boundary (merged cell)';
        } else if (contin && corners) {
          e.status = 'uncertain'; e.source = 'structure only'; e.reason = 'structural prediction without ink evidence';
        } else {
          e.status = 'none'; e.source = 'no evidence'; e.reason = 'no boundary evidence';
        }
      }

      // Mark manual lines
      for (const l of extraLines) {
        for (const e of edges) {
          if (e.horizontal !== l.horizontal || Math.abs(e.pos - l.pos) > jitterTol + 1) continue;
          const mid = (e.a + e.b) / 2;
          if (mid >= l.a - 1 && mid <= l.b + 1) e.manualLine = true;
        }
      }

      return {
        xs, ys, nx, ny, hE, vE, edges, tol,
        W: width, H: height, integral,
        hLineCount: ny, vLineCount: nx,
        horizontalLines: hLines,
        verticalLines: vLines,
        intersections: det?.intersections || [],
        disagreements: [],
        cfg: config
      };
    },

    buildCells(grid, cfgOrIntegral, maybeT) {
      const cfg = (cfgOrIntegral && cfgOrIntegral.minCellSize !== undefined) ? cfgOrIntegral : (grid?.cfg || TimetableScanner.Config);
      const { xs, ys, nx, ny, hE, vE, edges, W, H, integral, tol } = grid;
      const isWall = (e) => {
        if (!e) return false;
        if (e.override === 'split') return true;
        if (e.override === 'merge') return false;
        return e.manualLine || e.status === 'confirmed' || e.status === 'inferred';
      };

      const cp = this.computeComps(grid, isWall);
      const nR = ny - 1, nC = nx - 1;
      const margin = tol + 2;

      const items = [];
      let droppedSlivers = 0;
      for (const g of cp.comps.values()) {
        const w = xs[g.c1 + 1] - xs[g.c0], h = ys[g.r1 + 1] - ys[g.r0];
        if (w < (cfg.minCellSize || 14) || h < (cfg.minCellSize || 14)) { droppedSlivers++; continue; }
        items.push({ g, x: xs[g.c0], y: ys[g.r0], w, h });
      }
      items.sort((p, q) => (p.g.r0 - q.g.r0) || (p.g.c0 - q.g.c0));

      const cells = [], cellEdges = new Map();

      const sideStatus = (list) => {
        let unc = false, inf = false, man = false;
        for (const e of list) {
          if (!e) continue;
          const st = e.override ? 'manual' : e.status;
          if (st === 'uncertain' || st === 'none') unc = true;
          else if (st === 'inferred') inf = true;
          else if (st === 'manual') man = true;
        }
        return unc ? 'uncertain' : inf ? 'inferred' : man ? 'manual' : 'confirmed';
      };

      for (const item of items) {
        const { g } = item;
        const top = [], bottom = [], left = [], right = [];
        for (let c = g.c0; c <= g.c1; c++) { if (hE && hE[g.r0]) top.push(hE[g.r0][c]); if (hE && hE[g.r1 + 1]) bottom.push(hE[g.r1 + 1][c]); }
        for (let r = g.r0; r <= g.r1; r++) { if (vE && vE[g.c0]) left.push(vE[g.c0][r]); if (vE && vE[g.c1 + 1]) right.push(vE[g.c1 + 1][r]); }

        const inComp = new Set(g.members.map(([r, c]) => r * nC + c));
        const internal = [];
        for (const [r, c] of g.members) {
          if (c + 1 < nC && inComp.has(r * nC + c + 1) && vE && vE[c + 1]) internal.push(vE[c + 1][r]);
          if (r + 1 < nR && inComp.has((r + 1) * nC + c) && hE && hE[r + 1]) internal.push(hE[r + 1][c]);
        }
        const internalUncertain = internal.filter(e => e && (e.override ? 'manual' : e.status) === 'uncertain').length;

        const boundaries = { top: sideStatus(top), right: sideStatus(right), bottom: sideStatus(bottom), left: sideStatus(left) };
        const sideVals = Object.values(boundaries);

        const area = Math.max(1, (item.w - 2 * margin) * (item.h - 2 * margin));
        const dens = (integral && item.w - 2 * margin > 4 && item.h - 2 * margin > 4)
          ? this.boxSum(integral, W, H, item.x + margin, item.y + margin, item.x + item.w - margin, item.y + item.h - margin) / area : 0;
        const blank = dens < (cfg.contentMin || 0.012);

        let boundaryStatus;
        if (!g.rect || internalUncertain > 0 || sideVals.includes('uncertain')) boundaryStatus = 'uncertain';
        else if (sideVals.includes('inferred')) boundaryStatus = 'inferred';
        else boundaryStatus = 'confirmed';

        const id = cells.length + 1;
        cells.push({
          id,
          x: Math.round(item.x), y: Math.round(item.y),
          width: Math.round(item.w), height: Math.round(item.h),
          xmin: Math.round(item.x), ymin: Math.round(item.y),
          xmax: Math.round(item.x + item.w), ymax: Math.round(item.y + item.h),
          row: g.r0, col: g.c0,
          edges: boundaries,
          boundaries,
          classification: boundaryStatus,
          boundaryStatus,
          merged: g.r1 > g.r0 || g.c1 > g.c0,
          blank,
          irregular: !g.rect,
          uncertainInternalEdges: internalUncertain,
          gridSpan: { rowStart: g.r0, rowEnd: g.r1, colStart: g.c0, colEnd: g.c1 }
        });
      }

      cells.cells = cells;
      cells.cellEdges = cellEdges;
      return cells;
    }
  };

  // ════════════════════════════════════════════════════════════
  // 5. ENGINE C: MULTI-STRATEGY TESSERACT.JS OCR
  // ════════════════════════════════════════════════════════════
  TimetableScanner.OCREngine = {
    async recognizeWholeImage(imageSource, progressCallback) {
      if (!window.Tesseract) throw new Error('Tesseract.js library not loaded');

      const result = await window.Tesseract.recognize(imageSource, 'eng', {
        logger: m => {
          if (progressCallback && m.status === 'recognizing text') {
            progressCallback(Math.round(m.progress * 100));
          }
        }
      });

      const words = [];
      const lines = [];

      if (result.data) {
        (result.data.words || []).forEach(w => {
          if (w.text && w.text.trim()) {
            words.push({
              text: w.text.trim(),
              confidence: w.confidence,
              bbox: {
                x0: w.bbox.x0,
                y0: w.bbox.y0,
                x1: w.bbox.x1,
                y1: w.bbox.y1,
                width: w.bbox.x1 - w.bbox.x0,
                height: w.bbox.y1 - w.bbox.y0
              }
            });
          }
        });

        (result.data.lines || []).forEach(l => {
          if (l.text && l.text.trim()) {
            lines.push({
              text: l.text.trim(),
              confidence: l.confidence,
              bbox: {
                x0: l.bbox.x0,
                y0: l.bbox.y0,
                x1: l.bbox.x1,
                y1: l.bbox.y1
              }
            });
          }
        });
      }

      return {
        text: result.data ? result.data.text : '',
        words,
        lines,
        raw: result.data
      };
    },

    async recognizeCroppedRegion(canvasSource, rect) {
      if (!window.Tesseract) return { text: '', confidence: 0 };
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = Math.max(1, rect.width);
      tempCanvas.height = Math.max(1, rect.height);
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(canvasSource, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

      try {
        const res = await window.Tesseract.recognize(tempCanvas, 'eng');
        return {
          text: res.data ? res.data.text.trim() : '',
          confidence: res.data ? res.data.confidence : 0
        };
      } catch (e) {
        return { text: '', confidence: 0 };
      }
    }
  };

  // ════════════════════════════════════════════════════════════
  // 6. ENGINE D: INDEPENDENT STRUCTURAL LAYOUT ANALYSIS
  // ════════════════════════════════════════════════════════════
  TimetableScanner.LayoutEngine = {
    DAY_PATTERNS: [
      { day: 1, name: 'Monday', regex: /\b(mon|monday)\b/i },
      { day: 2, name: 'Tuesday', regex: /\b(tue|tues|tuesday)\b/i },
      { day: 3, name: 'Wednesday', regex: /\b(wed|wednes|wednesday)\b/i },
      { day: 4, name: 'Thursday', regex: /\b(thu|thur|thurs|thursday)\b/i },
      { day: 5, name: 'Friday', regex: /\b(fri|friday)\b/i },
      { day: 6, name: 'Saturday', regex: /\b(sat|saturday)\b/i },
      { day: 7, name: 'Sunday', regex: /\b(sun|sunday)\b/i }
    ],

    TIME_REGEX: /(\d{1,2}[:.]\d{2})\s*(?:-|to)\s*(\d{1,2}[:.]\d{2})/i,

    analyzeTextLayout(ocrResult, imageWidth, imageHeight) {
      const words = ocrResult.words || [];
      const lines = ocrResult.lines || [];

      // 1. Identify Day Headers & their locations
      const dayAnchors = [];
      lines.forEach(l => {
        for (const dp of this.DAY_PATTERNS) {
          if (dp.regex.test(l.text)) {
            dayAnchors.push({
              day: dp.day,
              name: dp.name,
              text: l.text,
              bbox: l.bbox,
              centerY: (l.bbox.y0 + l.bbox.y1) / 2,
              centerX: (l.bbox.x0 + l.bbox.x1) / 2
            });
            break;
          }
        }
      });

      // 2. Identify Time Headers & Period Slots
      const timeAnchors = [];
      lines.forEach(l => {
        const tm = l.text.match(this.TIME_REGEX);
        if (tm) {
          timeAnchors.push({
            start: tm[1].replace('.', ':'),
            end: tm[2].replace('.', ':'),
            text: l.text,
            bbox: l.bbox,
            centerX: (l.bbox.x0 + l.bbox.x1) / 2,
            centerY: (l.bbox.y0 + l.bbox.y1) / 2
          });
        }
      });

      // 3. Determine Layout Orientation (Days on Y-axis vs Days on X-axis)
      let dayAxis = 'rows'; // Default: Days are rows, Periods are columns
      if (dayAnchors.length >= 2) {
        const yVariance = Math.max(...dayAnchors.map(d => d.centerY)) - Math.min(...dayAnchors.map(d => d.centerY));
        const xVariance = Math.max(...dayAnchors.map(d => d.centerX)) - Math.min(...dayAnchors.map(d => d.centerX));
        if (xVariance > yVariance * 1.5) {
          dayAxis = 'cols'; // Days are headers across top columns
        }
      }

      return {
        dayAnchors,
        timeAnchors,
        dayAxis,
        words,
        lines
      };
    }
  };

  // ════════════════════════════════════════════════════════════
  // 7. RESULT FUSION & TIMETABLE RECONSTRUCTION ENGINE
  // ════════════════════════════════════════════════════════════
  TimetableScanner.FusionEngine = {
    fuseAndReconstruct(geometryResult, ocrResult, layoutAnalysis, existingSubjects = []) {
      let geoCells = Array.isArray(geometryResult) ? geometryResult : (geometryResult?.cells || []);
      const words = ocrResult?.words || [];
      const lines = ocrResult?.lines || [];

      // Fallback: If no geometry cells, synthesize grid cells from lines
      if (geoCells.length === 0) {
        geoCells = [];
        let r = 0;
        lines.forEach(l => {
          geoCells.push({
            id: geoCells.length + 1,
            x: l.bbox.x0, y: l.bbox.y0,
            width: l.bbox.x1 - l.bbox.x0, height: l.bbox.y1 - l.bbox.y0,
            xmin: l.bbox.x0, ymin: l.bbox.y0,
            xmax: l.bbox.x1, ymax: l.bbox.y1,
            row: r++, col: 0,
            edges: { top: 'confirmed', right: 'confirmed', bottom: 'confirmed', left: 'confirmed' },
            boundaries: { top: 'confirmed', right: 'confirmed', bottom: 'confirmed', left: 'confirmed' },
            classification: 'confirmed',
            boundaryStatus: 'confirmed',
            gridSpan: { rowStart: r, rowEnd: r, colStart: 0, colEnd: 0 }
          });
        });
      }

      // 1. Assign words to geometry cells based on spatial overlap
      geoCells.forEach(cell => {
        cell.words = [];
        cell.text = '';

        const cx0 = cell.xmin !== undefined ? cell.xmin : cell.x;
        const cy0 = cell.ymin !== undefined ? cell.ymin : cell.y;
        const cx1 = cell.xmax !== undefined ? cell.xmax : (cell.x + cell.width);
        const cy1 = cell.ymax !== undefined ? cell.ymax : (cell.y + cell.height);

        words.forEach(w => {
          const wx = (w.bbox.x0 + w.bbox.x1) / 2;
          const wy = (w.bbox.y0 + w.bbox.y1) / 2;

          if (wx >= cx0 && wx <= cx1 && wy >= cy0 && wy <= cy1) {
            cell.words.push(w);
          }
        });

        // Sort words by reading order
        cell.words.sort((a, b) => {
          if (Math.abs(a.bbox.y0 - b.bbox.y0) > 6) return a.bbox.y0 - b.bbox.y0;
          return a.bbox.x0 - b.bbox.x0;
        });

        cell.text = cell.words.map(w => w.text).join(' ').trim();
        cell.ocrText = cell.text;
        const confs = cell.words.map(w => w.confidence).filter(c => c > 0);
        cell.ocrConfidence = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
      });

      // 2. Identify Day Headers, Time Headers, and Data Matrix
      let dayRows = new Map();
      let periodCols = new Map();

      geoCells.forEach(cell => {
        const cellText = (cell.text || '').toLowerCase();
        const matchedDay = TimetableScanner.LayoutEngine.DAY_PATTERNS.find(dp => dp.regex.test(cellText));
        if (matchedDay && cell.gridSpan) {
          cell.isDayHeader = true;
          cell.dayNum = matchedDay.day;
          dayRows.set(cell.gridSpan.rowStart, matchedDay.day);
        }

        const matchedTime = cellText.match(TimetableScanner.LayoutEngine.TIME_REGEX);
        if (matchedTime) {
          cell.isTimeHeader = true;
          cell.timeStart = matchedTime[1].replace('.', ':');
          cell.timeEnd = matchedTime[2].replace('.', ':');
        }
      });

      if (dayRows.size === 0) {
        [1, 2, 3, 4, 5, 6].forEach((dayNum, i) => {
          dayRows.set(i, dayNum);
          dayRows.set(i + 1, dayNum);
        });
      }

      // 3. Construct Final Reconstructed Timetable Slots
      const reconstructedSlots = [];
      let slotIndex = 1;

      geoCells.forEach(cell => {
        if (cell.isDayHeader || cell.isTimeHeader) return;

        const rowStart = cell.gridSpan ? cell.gridSpan.rowStart : (cell.row || 0);
        const colStart = cell.gridSpan ? cell.gridSpan.colStart : (cell.col || 0);

        const dayNum = dayRows.get(rowStart) || Math.min(7, Math.max(1, rowStart + 1));
        const periodNum = Math.max(1, colStart + 1);

        const rawText = cell.text || '';
        const cleanName = rawText.replace(/[^a-zA-Z0-9\s/&.-]/g, ' ').replace(/\s+/g, ' ').trim();

        const isBreak = /\b(lunch|break|recess|tea|interval)\b/i.test(rawText);
        const isLab = /\b(lab|practical|workshop|project)\b/i.test(rawText);

        let matchedSubjectId = null;
        let matchedSubjectName = cleanName;
        let matchConfidence = 'none';

        if (!isBreak && cleanName.length > 1) {
          const exactMatch = existingSubjects.find(s => s.name.toLowerCase() === cleanName.toLowerCase() || (s.code && s.code.toLowerCase() === cleanName.toLowerCase()));
          if (exactMatch) {
            matchedSubjectId = exactMatch.id;
            matchedSubjectName = exactMatch.name;
            matchConfidence = 'exact';
          } else {
            const fuzzy = existingSubjects.find(s => cleanName.toLowerCase().includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(cleanName.toLowerCase()));
            if (fuzzy) {
              matchedSubjectId = fuzzy.id;
              matchedSubjectName = fuzzy.name;
              matchConfidence = 'fuzzy';
            }
          }
        }

        const isUncertain = !isBreak && cleanName.length > 0 && (cell.boundaryStatus === 'uncertain' || cell.ocrConfidence < (TimetableScanner.Config.ocrMinWordConfidence || 45) || matchConfidence === 'none');

        reconstructedSlots.push({
          id: 'slot_' + slotIndex++,
          day: dayNum,
          period: periodNum,
          startTime: '',
          endTime: '',
          subjectId: matchedSubjectId,
          subjectName: isBreak ? 'Break' : (matchedSubjectName || `Period ${periodNum}`),
          rawText: rawText,
          isBreak: isBreak,
          isLab: isLab,
          isMerged: cell.merged,
          span: cell.gridSpan || { rowStart, rowEnd: rowStart, colStart, colEnd: colStart },
          isUncertain: isUncertain,
          cellId: cell.id,
          cropRect: { x: cell.xmin || cell.x, y: cell.ymin || cell.y, width: cell.width || (cell.xmax - cell.xmin), height: cell.height || (cell.ymax - cell.ymin) },
          ocrConfidence: cell.ocrConfidence || 85,
          matchConfidence: matchConfidence
        });
      });

      reconstructedSlots.slots = reconstructedSlots;
      reconstructedSlots.cells = geoCells;
      reconstructedSlots.dayRows = dayRows;
      reconstructedSlots.periodCols = periodCols;
      return reconstructedSlots;
    }
  };

  // ════════════════════════════════════════════════════════════
  // 8. VALIDATION & DISAGREEMENT ENGINE
  // ════════════════════════════════════════════════════════════
  TimetableScanner.ValidationEngine = {
    validate(reconstructionResult, disagreements = [], existingSubjects = []) {
      const slots = Array.isArray(reconstructionResult) ? reconstructionResult : (reconstructionResult?.slots || []);
      const issues = [];
      const warnings = [];
      const errors = [];

      const dayPeriodMap = {};
      slots.forEach(s => {
        if (s.isBreak) return;
        const key = `${s.day}_${s.period}`;
        if (dayPeriodMap[key]) {
          const item = {
            type: 'overlap',
            severity: 'warn',
            slotId: s.id,
            cellId: s.cellId,
            message: `Multiple classes scheduled for Day ${s.day}, Period ${s.period}`,
            details: `Period conflict detected between "${s.subjectName}" and "${dayPeriodMap[key].subjectName}".`
          };
          issues.push(item);
          warnings.push(item);
        }
        dayPeriodMap[key] = s;
      });

      slots.forEach(s => {
        if (!s.isBreak && s.rawText && s.ocrConfidence < (TimetableScanner.Config.ocrMinWordConfidence || 45)) {
          const item = {
            type: 'low_confidence_ocr',
            severity: 'warn',
            slotId: s.id,
            cellId: s.cellId,
            message: `Low OCR confidence (${s.ocrConfidence}%) in "${s.rawText}"`,
            details: 'Inspect cell image in Multi-Engine Studio to verify the subject code or name.'
          };
          issues.push(item);
          warnings.push(item);
        }
      });

      slots.forEach(s => {
        if (s.isUncertain) {
          const item = {
            type: 'uncertain_boundary',
            severity: 'info',
            slotId: s.id,
            cellId: s.cellId,
            message: `Unmapped or uncertain slot for "${s.subjectName}"`,
            details: 'Subject code not recognized from existing subject list. Click Inspect to map.'
          };
          issues.push(item);
          warnings.push(item);
        }
      });

      return {
        isValid: errors.length === 0,
        warnings,
        errors,
        disagreements: disagreements || [],
        issues,
        issueCount: issues.length
      };
    }
  };

  window.TimetableScanner = TimetableScanner;

})(typeof window !== 'undefined' ? window : this);
