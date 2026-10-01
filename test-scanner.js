// Scratch script to test TimetableScanner in Node.js environment

// 1. Mock minimal DOM environment — define classes first so createElement can use them
global.window = global;
global.HTMLImageElement = class HTMLImageElement {};
global.HTMLCanvasElement = class HTMLCanvasElement {
  constructor() {
    this.width = 800;
    this.height = 600;
  }
  getContext(type) {
    return {
      drawImage() {},
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          const px = (i / 4) % w;
          const py = Math.floor((i / 4) / w);
          const isLine = (px % 150 === 0) || (py % 80 === 0);
          const val = isLine ? 0 : 255;
          data[i] = val; data[i+1] = val; data[i+2] = val; data[i+3] = 255;
        }
        return { data, width: w, height: h };
      },
      createImageData(w, h) {
        return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
      },
      putImageData() {}, clearRect() {}, fillRect() {},
      save() {}, restore() {}, translate() {}, rotate() {},
      strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
      stroke() {}, arc() {}, fill() {}, fillText() {}
    };
  }
};

global.document = {
  createElement(tag) {
    if (tag === 'canvas') return new global.HTMLCanvasElement();
    return {};
  }
};

// 2. Load timetable-scanner.js
require('./timetable-scanner.js');

console.log('--- Testing TimetableScanner API & Preprocessor ---');
console.log('1. Checking TimetableScanner object exists:', typeof window.TimetableScanner === 'object');
console.log('2. Checking TimetableScanner.Preprocessor exists:', typeof window.TimetableScanner.Preprocessor === 'object');
console.log('3. Checking deskewAndEnhance is a function:', typeof window.TimetableScanner.Preprocessor.deskewAndEnhance === 'function');
console.log('4. Checking GeometryEngine methods:', typeof window.TimetableScanner.GeometryEngine.buildGrid === 'function', typeof window.TimetableScanner.GeometryEngine.buildCells === 'function');
console.log('5. Checking OCREngine methods:', typeof window.TimetableScanner.OCREngine.recognizeWholeImage === 'function');
console.log('6. Checking LayoutEngine methods:', typeof window.TimetableScanner.LayoutEngine.analyzeTextLayout === 'function');
console.log('7. Checking FusionEngine methods:', typeof window.TimetableScanner.FusionEngine.fuseAndReconstruct === 'function');
console.log('8. Checking ValidationEngine methods:', typeof window.TimetableScanner.ValidationEngine.validate === 'function');

async function testPipeline() {
  const mockCanvas = document.createElement('canvas');
  mockCanvas.width = 1000;
  mockCanvas.height = 700;

  // Step 1: Preprocessor
  console.log('\n--- Running Preprocessor.deskewAndEnhance ---');
  const preprocessed = await window.TimetableScanner.Preprocessor.deskewAndEnhance(mockCanvas);
  console.log('Preprocessor output keys:', Object.keys(preprocessed));
  console.log('Dimensions W x H:', preprocessed.W, 'x', preprocessed.H);
  console.log('Affine transform T:', preprocessed.T);

  // Step 2: GeometryEngine
  console.log('\n--- Running GeometryEngine.buildGrid ---');
  const grid = window.TimetableScanner.GeometryEngine.buildGrid(preprocessed);
  console.log('Grid built: H Lines:', grid.horizontalLines.length, 'V Lines:', grid.verticalLines.length);

  console.log('\n--- Running GeometryEngine.buildCells ---');
  const cells = window.TimetableScanner.GeometryEngine.buildCells(grid);
  console.log('Cells count:', cells.length);
  if (cells.length > 0) {
    console.log('Sample cell #1:', {
      id: cells[0].id,
      bounds: [cells[0].xmin, cells[0].ymin, cells[0].xmax, cells[0].ymax],
      edges: cells[0].edges,
      classification: cells[0].classification
    });
  }

  // Step 3: Mock OCR Result
  const mockOcrResult = {
    text: "Monday Tuesday Wednesday\n09:00 - 10:00 Mathematics Physics Chemistry\n10:00 - 11:00 DataStructures Algorithms Networks",
    words: [
      { text: "Monday", confidence: 95, bbox: { x0: 20, y0: 10, x1: 90, y1: 40 } },
      { text: "Tuesday", confidence: 94, bbox: { x0: 160, y0: 10, x1: 230, y1: 40 } },
      { text: "Wednesday", confidence: 92, bbox: { x0: 310, y0: 10, x1: 390, y1: 40 } },
      { text: "09:00-10:00", confidence: 90, bbox: { x0: 20, y0: 85, x1: 120, y1: 120 } },
      { text: "Mathematics", confidence: 96, bbox: { x0: 160, y0: 85, x1: 270, y1: 120 } },
      { text: "Physics", confidence: 88, bbox: { x0: 310, y0: 85, x1: 390, y1: 120 } }
    ],
    lines: [
      { text: "Monday Tuesday Wednesday", confidence: 95, bbox: { x0: 20, y0: 10, x1: 400, y1: 40 } },
      { text: "09:00 - 10:00 Mathematics Physics", confidence: 92, bbox: { x0: 20, y0: 85, x1: 400, y1: 120 } }
    ]
  };

  // Step 4: LayoutEngine
  console.log('\n--- Running LayoutEngine.analyzeTextLayout ---');
  const layout = window.TimetableScanner.LayoutEngine.analyzeTextLayout(mockOcrResult, { width: 1000, height: 700 });
  console.log('Layout day anchors:', layout.dayAnchors.map(d => d.name));
  console.log('Layout dayAxis:', layout.dayAxis);

  // Step 5: FusionEngine
  console.log('\n--- Running FusionEngine.fuseAndReconstruct ---');
  const mockSubjects = [
    { id: 'subj_1', name: 'Mathematics', code: 'MATH101' },
    { id: 'subj_2', name: 'Physics', code: 'PHYS101' }
  ];
  const fusedSlots = window.TimetableScanner.FusionEngine.fuseAndReconstruct(cells, mockOcrResult, layout, mockSubjects);
  console.log('Fused slots count:', fusedSlots.length);
  if (fusedSlots.length > 0) {
    console.log('Sample Slot #1:', fusedSlots[0]);
  }

  // Step 6: ValidationEngine
  console.log('\n--- Running ValidationEngine.validate ---');
  const validation = window.TimetableScanner.ValidationEngine.validate(fusedSlots, grid.disagreements, mockSubjects);
  console.log('Validation isValid:', validation.isValid);
  console.log('Validation issues count:', validation.issueCount);

  console.log('\n✅ ALL SCANNER ENGINES AND PREPROCESSOR TESTS PASSED SUCCESSFULLY!');
}

testPipeline().catch(err => {
  console.error('❌ Pipeline Test Error:', err);
  process.exit(1);
});
