/**
 * Complete Figma Data Processing Library - Type Definitions
 *
 * Comprehensive types that preserve ALL data from Figma REST API responses.
 * Based on @figma/rest-api-spec with enhancements for complete extraction.
 */

// ============================================================================
// Node Types
// ============================================================================

export type NodeType =
  | 'DOCUMENT'
  | 'CANVAS'
  | 'FRAME'
  | 'GROUP'
  | 'VECTOR'
  | 'BOOLEAN_OPERATION'
  | 'STAR'
  | 'LINE'
  | 'ELLIPSE'
  | 'REGULAR_POLYGON'
  | 'RECTANGLE'
  | 'TEXT'
  | 'SLICE'
  | 'COMPONENT'
  | 'COMPONENT_SET'
  | 'INSTANCE'
  | 'STICKY'
  | 'SHAPE_WITH_TEXT'
  | 'CONNECTOR'
  | 'WIDGET'
  | 'EMBED'
  | 'LINK_UNFURL'
  | 'MEDIA'
  | 'SECTION'
  | 'HIGHLIGHT'
  | 'STAMP'
  | 'WASHI_TAPE'
  | 'TABLE'
  | 'TABLE_CELL';

// ============================================================================
// Geometry & Transform
// ============================================================================

export interface Transform {
  0: [number, number, number];
  1: [number, number, number];
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  x: number;
  y: number;
}

export interface Vector {
  x: number;
  y: number;
}

// ============================================================================
// Layout Properties
// ============================================================================

export type LayoutMode = 'NONE' | 'HORIZONTAL' | 'VERTICAL';

export type LayoutSizingMode = 'FIXED' | 'HUG' | 'FILL';

export interface LayoutSizing {
  horizontal: LayoutSizingMode;
  vertical: LayoutSizingMode;
}

export type LayoutAlign = 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';

export type AlignItems = 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';

export interface Padding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// ============================================================================
// Constraints
// ============================================================================

export type ConstraintType = 'MIN' | 'MAX' | 'CENTER' | 'SCALE' | 'STRETCH';

export interface Constraints {
  horizontal: ConstraintType;
  vertical: ConstraintType;
}

// ============================================================================
// Paint (Fills & Strokes)
// ============================================================================

export type PaintType = 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND' | 'IMAGE' | 'EMOJI' | 'VIDEO';

export type BlendMode =
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorStop {
  position: number;
  color: Color;
}

export interface ImageFilters {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

export interface Paint {
  type: PaintType;
  visible?: boolean;
  opacity?: number;
  color?: Color;
  blendMode?: BlendMode;

  // Gradient
  gradientHandlePositions?: Vector[];
  gradientStops?: ColorStop[];

  // Image
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH';
  imageTransform?: Transform;
  scalingFactor?: number;
  rotation?: number;
  imageRef?: string;
  filters?: ImageFilters;

  // Variable binding
  boundVariables?: {
    color?: VariableAlias;
  };
}

export interface VariableAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

// ============================================================================
// Strokes
// ============================================================================

export type StrokeAlign = 'INSIDE' | 'OUTSIDE' | 'CENTER';

export type StrokeCap = 'NONE' | 'ROUND' | 'SQUARE' | 'LINE_ARROW' | 'TRIANGLE_ARROW';

export type StrokeJoin = 'MITER' | 'BEVEL' | 'ROUND';

export interface Stroke extends Paint {
  strokeAlign?: StrokeAlign;
}

export interface IndividualStrokeWeights {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ============================================================================
// Effects
// ============================================================================

export type EffectType = 'INNER_SHADOW' | 'DROP_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';

export interface Effect {
  type: EffectType;
  visible?: boolean;
  radius: number;
  color?: Color;
  blendMode?: BlendMode;
  offset?: Vector;
  spread?: number;
  showShadowBehindNode?: boolean;

  // Variable binding
  boundVariables?: {
    color?: VariableAlias;
    radius?: VariableAlias;
  };
}

// ============================================================================
// Text Properties
// ============================================================================

export type TextAlignHorizontal = 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';

export type TextAlignVertical = 'TOP' | 'CENTER' | 'BOTTOM';

export type TextAutoResize = 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE';

export type TextCase = 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS' | 'SMALL_CAPS_FORCED';

export type TextDecoration = 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';

export type TextTruncation = 'DISABLED' | 'ENDING';

export type LineHeightUnit = 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%';

export interface TypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  italic?: boolean;
  fontWeight?: number;
  fontSize?: number;
  textCase?: TextCase;
  textDecoration?: TextDecoration;
  textAlignHorizontal?: TextAlignHorizontal;
  textAlignVertical?: TextAlignVertical;
  letterSpacing?: number;
  fills?: Paint[];
  hyperlink?: Hyperlink;
  opentypeFlags?: Record<string, number>;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: LineHeightUnit;
}

export interface Hyperlink {
  type: 'URL' | 'NODE';
  url?: string;
  nodeId?: string;
}

export interface StyledTextSegment {
  characters: string;
  start: number;
  end: number;
  style: TypeStyle;
}

// ============================================================================
// Component Properties
// ============================================================================

export type ComponentPropertyType = 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP';

export interface InstanceSwapPreferredValue {
  type: 'COMPONENT' | 'COMPONENT_SET';
  key: string;
}

export interface ComponentPropertyDefinition {
  type: ComponentPropertyType;
  defaultValue: string | boolean;
  variantOptions?: string[];
  preferredValues?: InstanceSwapPreferredValue[];
}

export interface ComponentProperty {
  type: ComponentPropertyType;
  value: string | boolean;
  preferredValues?: InstanceSwapPreferredValue[];
  boundVariables?: {
    value?: VariableAlias;
  };
}

// ============================================================================
// Variables
// ============================================================================

export type VariableResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type VariableScope =
  | 'ALL_SCOPES'
  | 'ALL_FILLS'
  | 'FRAME_FILL'
  | 'SHAPE_FILL'
  | 'TEXT_FILL'
  | 'STROKE_COLOR'
  | 'EFFECT_COLOR'
  | 'WIDTH_HEIGHT'
  | 'GAP'
  | 'CORNER_RADIUS'
  | 'OPACITY';

export interface VariableDefinition {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: VariableResolvedType;
  valuesByMode: Record<string, any>;
  scopes: VariableScope[];
  codeSyntax?: Record<string, string>;
  description?: string;
  hiddenFromPublishing?: boolean;
}

export interface VariableCollection {
  id: string;
  name: string;
  key: string;
  modes: Array<{
    modeId: string;
    name: string;
  }>;
  defaultModeId: string;
  remote?: boolean;
  hiddenFromPublishing?: boolean;
}

// ============================================================================
// Styles
// ============================================================================

export interface StyleDefinition {
  key: string;
  name: string;
  description?: string;
  remote?: boolean;
  styleType: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
}

export interface TextStyleDefinition extends StyleDefinition {
  styleType: 'TEXT';
  style: TypeStyle;
}

export interface FillStyleDefinition extends StyleDefinition {
  styleType: 'FILL';
  fills: Paint[];
}

export interface StrokeStyleDefinition extends StyleDefinition {
  styleType: 'FILL';
  strokes: Stroke[];
}

export interface EffectStyleDefinition extends StyleDefinition {
  styleType: 'EFFECT';
  effects: Effect[];
}

export interface GridStyleDefinition extends StyleDefinition {
  styleType: 'GRID';
  grids: LayoutGrid[];
}

export interface LayoutGrid {
  pattern: 'COLUMNS' | 'ROWS' | 'GRID';
  sectionSize?: number;
  visible?: boolean;
  color?: Color;
  alignment?: 'MIN' | 'MAX' | 'CENTER' | 'STRETCH';
  gutterSize?: number;
  offset?: number;
  count?: number;
}

// ============================================================================
// Component & Component Set Definitions
// ============================================================================

export interface DocumentationLink {
  uri: string;
  label?: string;
}

export interface ComponentDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  documentationLinks?: DocumentationLink[];
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  remote?: boolean;
  componentSetId?: string;
}

export interface ComponentSetDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  documentationLinks?: DocumentationLink[];
  componentPropertyDefinitions?: Record<string, ComponentPropertyDefinition>;
  variantGroupProperties?: Record<string, VariantProperty>;
}

export interface VariantProperty {
  values: string[];
}

// ============================================================================
// Export Settings
// ============================================================================

export type ExportFormat = 'JPG' | 'PNG' | 'SVG' | 'PDF';

export interface ExportSetting {
  suffix: string;
  format: ExportFormat;
  constraint?: {
    type: 'SCALE' | 'WIDTH' | 'HEIGHT';
    value: number;
  };
}

// ============================================================================
// Complete Node Definition
// ============================================================================

export interface CompleteNode {
  // Base properties (always present)
  id: string;
  name: string;
  type: NodeType;
  visible: boolean;
  locked?: boolean;

  // Geometry (PRESERVED from FigmaToCode approach)
  absoluteBoundingBox?: Rectangle;
  relativeTransform?: Transform;
  size?: Size;

  // Rotation (PRESERVED)
  rotation?: number;

  // Layout (COMPLETE - all properties)
  layoutMode?: LayoutMode;
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  layoutSizing?: LayoutSizing;
  layoutAlign?: LayoutAlign;
  layoutGrow?: number;
  padding?: Padding;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  primaryAxisAlignItems?: AlignItems;
  counterAxisAlignItems?: AlignItems;
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';

  // Constraints (PRESERVED)
  constraints?: Constraints;

  // Text (COMPLETE)
  characters?: string;
  textStyle?: string; // Reference to globalVars
  namedTextStyle?: string; // Reference to styles.text
  namedTextStyleName?: string; // Resolved style name (e.g., "Heading/H1")
  styledTextSegments?: StyledTextSegment[]; // From FigmaToCode
  style?: TypeStyle; // Inline text style
  textAlignHorizontal?: TextAlignHorizontal;
  textAlignVertical?: TextAlignVertical;
  textAutoResize?: TextAutoResize;
  textTruncation?: TextTruncation;
  maxLines?: number;
  lineHeight?: any; // Can be number or 'AUTO'
  letterSpacing?: number;

  // Visuals (COMPLETE with variable references)
  fills?: Paint[];
  fillsRef?: string; // Reference to globalVars
  namedFillStyle?: string; // Reference to styles.fill
  fillVariableIds?: Record<number, string>; // Variable bindings
  fillGeometry?: any[]; // Paint geometry

  strokes?: Stroke[];
  strokesRef?: string; // Reference to globalVars
  namedStrokeStyle?: string; // Reference to styles.stroke
  strokeVariableIds?: Record<number, string>;
  strokeWeight?: number;
  individualStrokeWeights?: IndividualStrokeWeights;
  strokeCap?: StrokeCap;
  strokeJoin?: StrokeJoin;
  strokeDashes?: number[];
  strokeMiterAngle?: number;
  strokeGeometry?: any[]; // Stroke geometry
  strokeAlign?: StrokeAlign;

  effects?: Effect[];
  effectsRef?: string; // Reference to globalVars
  namedEffectStyle?: string; // Reference to styles.effect
  effectVariableIds?: Record<string, string>;

  opacity?: number;
  opacityVariableId?: string;

  blendMode?: BlendMode;
  isMask?: boolean;
  isMaskOutline?: boolean;
  maskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE';

  // Border radius (COMPLETE)
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  cornerSmoothing?: number;

  // Component system (COMPLETE - THE KEY ADDITION)
  componentId?: string; // Reference to main component
  componentSetId?: string; // Reference to parent set
  mainComponent?: any; // Reference to main component node

  componentProperties?: Record<string, ComponentProperty>; // Instance overrides
  componentPropertyReferences?: Record<string, string | { nodeId: string; nodeName?: string; nodeType?: string }>;

  // Hierarchy
  children?: CompleteNode[];
  parent?: string; // Parent node ID

  // Simplified references (for quick access)
  layoutRef?: string; // Reference to globalVars.layouts

  // Export settings (PRESERVED)
  exportSettings?: ExportSetting[];

  // Backgrounds
  backgrounds?: Paint[];
  backgroundVariableIds?: Record<number, string>;

  // Clipping
  clipsContent?: boolean;

  // Guides
  layoutGrids?: LayoutGrid[];
  gridStyleId?: string;

  // Boolean operations
  booleanOperation?: 'UNION' | 'INTERSECT' | 'SUBTRACT' | 'EXCLUDE';

  // Prototype interactions
  transitionNodeID?: string;
  transitionDuration?: number;
  transitionEasing?: string;

  // Plugin data
  pluginData?: Record<string, any>;
  sharedPluginData?: Record<string, Record<string, any>>;

  // Vector data
  vectorNetwork?: any;
  vectorPaths?: any[];

  // Preserving aspect ratio
  preserveRatio?: boolean;

  // Layout positioning
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';

  // Reactions (prototyping)
  reactions?: any[];

  // Overrides
  overrides?: any[];
}

// ============================================================================
// Simplified/Deduplicated Styles (GlobalVars)
// ============================================================================

export interface SimplifiedLayout {
  display?: string;
  flexDirection?: string;
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  padding?: string;
  width?: string;
  height?: string;
  position?: string;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  [key: string]: any;
}

export interface SimplifiedTextStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number | string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  color?: string;
  textDecoration?: string;
  textTransform?: string;
  [key: string]: any;
}

export interface SimplifiedFill {
  type: PaintType;
  color?: string;
  gradient?: string;
  imageUrl?: string;
  opacity?: number;
  blendMode?: string;
}

export interface SimplifiedStroke {
  color?: string;
  width?: number;
  style?: string;
  position?: StrokeAlign;
}

export interface SimplifiedEffects {
  boxShadow?: string[];
  filter?: string[];
}

// ============================================================================
// Complete Figma Design Output
// ============================================================================

export interface CompleteFigmaDesign {
  // Metadata
  name: string;
  version: string;
  lastModified: string;
  schemaVersion?: number;

  // Main content
  nodes: CompleteNode[];

  // Component system (COMPLETE - no loss)
  components: Record<string, ComponentDefinition>;
  componentSets: Record<string, ComponentSetDefinition>;

  // Styles system (COMPLETE - includes all metadata)
  styles: {
    text: Record<string, TextStyleDefinition>;
    fill: Record<string, FillStyleDefinition>;
    stroke: Record<string, StrokeStyleDefinition>;
    effect: Record<string, EffectStyleDefinition>;
    grid: Record<string, GridStyleDefinition>;
  };

  // Variables system (NEW - from API)
  variables: {
    colors: Record<string, VariableDefinition>;
    numbers: Record<string, VariableDefinition>;
    strings: Record<string, VariableDefinition>;
    booleans: Record<string, VariableDefinition>;
  };

  variableCollections?: Record<string, VariableCollection>;

  // Deduplicated computed styles (for efficiency)
  globalVars: {
    layouts: Record<string, SimplifiedLayout>;
    textStyles: Record<string, SimplifiedTextStyle>;
    fills: Record<string, SimplifiedFill[]>;
    strokes: Record<string, SimplifiedStroke>;
    effects: Record<string, SimplifiedEffects>;
  };
}

// ============================================================================
// Extractor & Context Types
// ============================================================================

export interface ExtractionContext {
  // Metadata from API
  components: Record<string, any>;
  componentSets: Record<string, any>;
  styles: {
    text: Record<string, any>;
    fill: Record<string, any>;
    stroke: Record<string, any>;
    effect: Record<string, any>;
    grid: Record<string, any>;
  };
  variables: Record<string, any>;
  variableCollections: Record<string, any>;

  // Global deduplication maps
  globalVars: CompleteFigmaDesign['globalVars'];

  // Parent tracking
  parentNode?: CompleteNode;
  depth: number;

  // Options
  maxDepth?: number;
  preserveHiddenNodes?: boolean;
  includeAbsoluteBounds?: boolean;
  includeRelativeTransform?: boolean;
}

export type ExtractorFn = (
  node: any,
  result: Partial<CompleteNode>,
  context: ExtractionContext
) => void;

export interface ExtractionOptions {
  maxDepth?: number;
  preserveHiddenNodes?: boolean;
  includeAbsoluteBounds?: boolean;
  includeRelativeTransform?: boolean;
  extractors?: ExtractorFn[];
}

// ============================================================================
// API Parser Types
// ============================================================================

export interface ParsedAPIData {
  document: any; // Raw document from API
  components: Record<string, any>;
  componentSets: Record<string, any>;
  styles: {
    text: Record<string, any>;
    fill: Record<string, any>;
    stroke: Record<string, any>;
    effect: Record<string, any>;
    grid: Record<string, any>;
  };
  variables: Record<string, any>;
  variableCollections: Record<string, any>;
  schemaVersion?: number;
  name: string;
  version: string;
  lastModified: string;
}
