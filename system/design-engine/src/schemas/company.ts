// company-data/ のスキーマ（未知キーは許容 = loose）
import { z } from 'zod';
import { HEX_COLOR_RE, NonEmpty, NumOrText, RelPath, isSafeCssValue, listOf, requiredListOf, uniqueBy } from './common.ts';

const Str = z.string();
/** 文字列または構造化データ（カリキュラム等の自由記述項目） */
const StrOrRecord = z.union([z.string(), z.record(z.string(), z.unknown())]);

// ---- facts/school.yaml ----
export const AddressSchema = z.looseObject({
  postal_code: Str.optional(),
  prefecture: Str.optional(),
  city: Str.optional(),
  line1: Str.optional(),
  line2: Str.optional(),
});

export const SchoolSchema = z.looseObject({
  name: NonEmpty,
  name_en: Str.optional(),
  short_name: Str.optional(),
  corporation: Str.optional(),
  established: NumOrText.optional(),
  address: AddressSchema.optional(),
  tel: Str.optional(),
  fax: Str.optional(),
  email: Str.optional(),
  url: Str.optional(),
  access: z.array(Str).optional(),
});
export type School = z.output<typeof SchoolSchema>;

// ---- facts/courses.yaml ----
export const CourseSchema = z.looseObject({
  id: NonEmpty,
  name: NonEmpty,
  name_en: Str.optional(),
  years: NumOrText,
  capacity: NumOrText.optional(),
  description: Str,
  tags: z.array(Str).optional(),
  curriculum: z.array(StrOrRecord).optional(),
  qualifications: z.array(StrOrRecord).optional(),
  careers: z.array(StrOrRecord).optional(),
  photo: Str.optional(),
});
export type Course = z.output<typeof CourseSchema>;

export const CoursesFileSchema = z.looseObject({
  courses: requiredListOf(CourseSchema).superRefine(uniqueBy((c: Course) => c.id)),
});
export type CoursesFile = z.output<typeof CoursesFileSchema>;

// ---- facts/teachers.yaml ----
export const TeacherSchema = z.looseObject({
  id: NonEmpty,
  name: NonEmpty,
  name_kana: Str.optional(),
  title: Str.optional(),
  course_ids: z.array(Str).optional(),
  profile: Str.optional(),
  photo: Str.optional(),
});
export type Teacher = z.output<typeof TeacherSchema>;

export const TeachersFileSchema = z.looseObject({
  teachers: requiredListOf(TeacherSchema).superRefine(uniqueBy((t: Teacher) => t.id)),
});
export type TeachersFile = z.output<typeof TeachersFileSchema>;

// ---- facts/results.yaml ----
export const MetricSchema = z.looseObject({
  id: NonEmpty,
  label: NonEmpty,
  value: NumOrText,
  unit: Str.optional(),
  as_of: NumOrText.optional(),
  source: Str.optional(),
  note: Str.optional(),
});
export type Metric = z.output<typeof MetricSchema>;

export const EmployerSchema = z.looseObject({ name: NonEmpty, note: Str.optional() });
export const CertificationSchema = z.looseObject({
  name: NonEmpty,
  count: NumOrText.optional(),
  as_of: NumOrText.optional(),
});

export const ResultsFileSchema = z.looseObject({
  metrics: requiredListOf(MetricSchema).superRefine(uniqueBy((m: Metric) => m.id)),
  employers: z.array(EmployerSchema).optional(),
  certifications: z.array(CertificationSchema).optional(),
});
export type ResultsFile = z.output<typeof ResultsFileSchema>;

// ---- facts/contacts.yaml ----
export const ContactSchema = z.looseObject({
  id: NonEmpty,
  label: NonEmpty,
  tel: Str.optional(),
  email: Str.optional(),
  url: Str.optional(),
  hours: Str.optional(),
  note: Str.optional(),
});
export type Contact = z.output<typeof ContactSchema>;

export const SnsSchema = z.looseObject({ service: NonEmpty, url: Str });

export const ContactsFileSchema = z.looseObject({
  contacts: requiredListOf(ContactSchema).superRefine(uniqueBy((c: Contact) => c.id)),
  sns: z.array(SnsSchema).optional(),
});
export type ContactsFile = z.output<typeof ContactsFileSchema>;

/** facts/<basename>.yaml ごとのスキーマ。ここにない basename は自由形式として読み込む */
export const FACT_SCHEMAS = {
  school: SchoolSchema,
  courses: CoursesFileSchema,
  teachers: TeachersFileSchema,
  results: ResultsFileSchema,
  contacts: ContactsFileSchema,
} as const;

export const FreeFormSchema = z.preprocess((v) => (v == null ? {} : v), z.record(z.string(), z.unknown()));

// ---- brand/colors/colors.yaml ----
export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'text', 'muted', 'background', 'surface'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** #RRGGBB 等の16進カラー。未確定の間は "TODO: ..." も許容（描画時はグレーで代替し警告） */
export const ColorValue = z.string().refine((v) => HEX_COLOR_RE.test(v) || v.startsWith('TODO'), {
  message: '16進カラー（例: #1a4fa0）で指定してください（未確定なら "TODO: ..."）',
});

export const ColorsFileSchema = z.looseObject({
  colors: z.looseObject({
    primary: ColorValue,
    secondary: ColorValue,
    accent: ColorValue,
    text: ColorValue,
    muted: ColorValue,
    background: ColorValue,
    surface: ColorValue,
  }),
  status: z.enum(['provisional', 'final']).optional(),
});
export type ColorsFile = z.output<typeof ColorsFileSchema>;
export type BrandColors = ColorsFile['colors'];

// ---- brand/fonts/fonts.yaml ----
export const DEFAULT_SANS = '"Noto Sans JP", sans-serif';
export const DEFAULT_SERIF = '"Noto Serif JP", serif';

const FontFamily = z.string().min(1).refine(isSafeCssValue, { message: 'font-family に ; { } < > は使えません' });

export const FontsFileSchema = z.looseObject({
  families: z
    .looseObject({
      heading: FontFamily.default(DEFAULT_SANS),
      body: FontFamily.default(DEFAULT_SANS),
      serif: FontFamily.default(DEFAULT_SERIF),
      number: FontFamily.default(DEFAULT_SANS),
    })
    .default({ heading: DEFAULT_SANS, body: DEFAULT_SANS, serif: DEFAULT_SERIF, number: DEFAULT_SANS }),
});
export type FontsFile = z.output<typeof FontsFileSchema>;
export type BrandFonts = FontsFile['families'];

// ---- brand/logo/logo.yaml ----
export const LogoSchema = z.looseObject({
  id: NonEmpty,
  file: RelPath,
  variant: Str.optional(),
  note: Str.optional(),
});
export type Logo = z.output<typeof LogoSchema>;

export const LogosFileSchema = z.looseObject({
  logos: listOf(LogoSchema).superRefine(uniqueBy((l: Logo) => l.id)),
});
export type LogosFile = z.output<typeof LogosFileSchema>;

// ---- photos/photos.yaml ----
export const PhotoSchema = z.looseObject({
  id: NonEmpty,
  file: RelPath,
  caption: Str.optional(),
  credit: Str.optional(),
  rights: Str.optional(),
  tags: z.array(Str).optional(),
});
export type Photo = z.output<typeof PhotoSchema>;

export const PhotosFileSchema = z.looseObject({
  photos: listOf(PhotoSchema).superRefine(uniqueBy((p: Photo) => p.id)),
});
export type PhotosFile = z.output<typeof PhotosFileSchema>;
