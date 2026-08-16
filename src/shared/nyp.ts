/**
 * NYP reference data: schools, diplomas, and the competencies each diploma covers.
 *
 * Real institutional data, kept apart from `seed.ts` (made-up demo students) so
 * it can be corrected without touching the demo, and vice versa.
 *
 * A student's course lives on their user record, chosen once at registration —
 * NYP student mail is derived from the admin number and does not encode the
 * course, so there is nothing in the address to read it from.
 */

export interface SchoolCourses {
  school: string
  courses: string[]
}

/**
 * Every diploma and common programme, grouped by the school that offers it.
 * "Common Business & Technology Programme" is intentionally listed under all
 * three schools that run it — see `schoolsForCourse`.
 */
export const NYP_COURSE_CATALOG: SchoolCourses[] = [
  {
    school: 'School of Applied Science',
    courses: [
      'Diploma in Applied Chemistry',
      'Diploma in Biologics & Process Technology',
      'Diploma in Biomedical Science with Analytics',
      'Diploma in Chemical & Pharmaceutical Technology',
      'Diploma in Food Science & Nutrition',
      'Diploma in Pharmaceutical Science',
      'Common Science Programme',
    ],
  },
  {
    school: 'School of Business Management',
    courses: [
      'Diploma in Accountancy & Finance',
      'Diploma in Banking & Finance',
      'Diploma in Business Management',
      'Diploma in Food & Beverage Business',
      'Diploma in Hospitality & Tourism Management',
      'Diploma in Media & Communication Management',
      'Diploma in Sport & Wellness Management',
      'Common Business Programme',
      'Common Business & Technology Programme',
    ],
  },
  {
    school: 'School of Design & Media',
    courses: [
      'Diploma in Animation, Games & Visual Effects',
      'Diploma in Architecture',
      'Diploma in Communication & Motion Design',
      'Diploma in Experience Design',
      'Diploma in Game Development & Technology',
      'Common Design & Media Programme',
    ],
  },
  {
    school: 'School of Engineering',
    courses: [
      'Diploma in Advanced & Digital Manufacturing',
      'Diploma in Aerospace Engineering',
      'Diploma in AI & Data Engineering',
      'Diploma in AI Robotics',
      'Diploma in Biomedical Engineering',
      'Diploma in Cloud Engineering',
      'Diploma in Electronic & Computer Engineering',
      'Diploma in Sustainability in Engineering with Business',
      'Common Engineering Programme',
      'Common Business & Technology Programme',
    ],
  },
  {
    school: 'School of Health & Social Sciences',
    courses: ['Diploma in Nursing', 'Diploma in Oral Health Therapy', 'Diploma in Social Work'],
  },
  {
    school: 'School of Information Technology',
    courses: [
      'Diploma in Applied AI & Analytics',
      'Diploma in Business & Financial Technology',
      'Diploma in Computing',
      'Diploma in Cybersecurity & Digital Forensics',
      'Common ICT Programme',
      'Common Business & Technology Programme',
    ],
  },
]

/** Every course once, in catalog order. Use this to validate a stored course. */
export const NYP_COURSES: string[] = [
  ...new Set(NYP_COURSE_CATALOG.flatMap((group) => group.courses)),
]

/** Schools offering a course. Usually one; the shared programme returns three. */
export function schoolsForCourse(course: string): string[] {
  return NYP_COURSE_CATALOG.filter((group) => group.courses.includes(course)).map((g) => g.school)
}

/**
 * The school to display for a course, or null when it is offered by more than
 * one — showing a single arbitrary school there would just be wrong.
 */
export function primarySchool(course: string): string | null {
  const schools = schoolsForCourse(course)
  return schools.length === 1 ? schools[0] : null
}

// ---------------------------------------------------------------- competencies

/**
 * The main competencies each course covers. These are the units students match
 * on — deliberately not module codes, because a competency like "Programming"
 * is shared by five different diplomas, which is exactly what lets a Computing
 * student tutor someone from Engineering.
 */
export const DIPLOMA_COMPETENCIES: Record<string, string[]> = {
  // School of Applied Science
  'Diploma in Applied Chemistry': [
    'Chemistry & Chemical Analysis',
    'Laboratory Techniques',
    'Synthesis & Purification',
    'Instrumental Analysis',
    'Quality Control',
  ],
  'Diploma in Biologics & Process Technology': [
    'Bioprocessing',
    'Biologics Manufacturing',
    'Laboratory Techniques',
    'Quality Control',
    'Pharmaceutical Processing',
  ],
  'Diploma in Biomedical Science with Analytics': [
    'Biomedical Science',
    'Clinical Diagnostics',
    'Laboratory Skills',
    'Data Analytics',
    'Biomedical Research',
  ],
  'Diploma in Chemical & Pharmaceutical Technology': [
    'Chemical Processing',
    'Pharmaceutical Manufacturing',
    'Laboratory Techniques',
    'Quality Control',
    'Process Technology',
  ],
  'Diploma in Food Science & Nutrition': [
    'Food Science',
    'Food Technology',
    'Food Safety',
    'Nutrition',
    'Food Product Development',
  ],
  'Diploma in Pharmaceutical Science': [
    'Pharmaceutical Science',
    'Pharmacology',
    'Pharmaceutical Chemistry',
    'Pharmacy Practice',
    'Drug Development',
  ],
  'Common Science Programme': [
    'Chemistry',
    'Biology',
    'Mathematics',
    'Laboratory Skills',
    'Scientific Research',
  ],

  // School of Business Management
  'Diploma in Accountancy & Finance': [
    'Financial Accounting',
    'Management Accounting',
    'Finance',
    'Auditing',
    'Taxation',
  ],
  'Diploma in Banking & Finance': [
    'Banking',
    'Financial Markets',
    'Investment',
    'Financial Analysis',
    'Risk Management',
  ],
  'Diploma in Business Management': [
    'Business Management',
    'Marketing',
    'Finance',
    'Human Resource Management',
    'Business Analytics',
  ],
  'Diploma in Food & Beverage Business': [
    'F&B Operations',
    'Restaurant Management',
    'Marketing',
    'Customer Experience',
    'F&B Entrepreneurship',
  ],
  'Diploma in Hospitality & Tourism Management': [
    'Hospitality Management',
    'Tourism Management',
    'Hotel Operations',
    'Events Management',
    'Customer Experience',
  ],
  'Diploma in Media & Communication Management': [
    'Media Management',
    'Digital Marketing',
    'Communication',
    'Content Creation',
    'Public Relations',
  ],
  'Diploma in Sport & Wellness Management': [
    'Sports Management',
    'Sports Marketing',
    'Fitness & Wellness',
    'Sports Events',
    'Business Management',
  ],
  'Common Business Programme': [
    'Business Management',
    'Accounting',
    'Marketing',
    'Economics',
    'Business Analytics',
  ],
  'Common Business & Technology Programme': [
    'Business Management',
    'Technology',
    'Programming',
    'Data Analytics',
    'Digital Business',
  ],

  // School of Design & Media
  'Diploma in Animation, Games & Visual Effects': [
    'Animation',
    '2D & 3D Art',
    'Game Development',
    'Visual Effects',
    'Storytelling',
  ],
  'Diploma in Architecture': [
    'Architectural Design',
    'Building Technology',
    'Sustainable Architecture',
    '3D Visualisation',
    'Computational Design',
  ],
  'Diploma in Communication & Motion Design': [
    'Graphic Design',
    'Visual Communication',
    'Motion Graphics',
    'Branding',
    'Digital Media',
  ],
  'Diploma in Experience Design': [
    'UX Design',
    'UI Design',
    'User Research',
    'Interaction Design',
    'Service Design',
  ],
  'Diploma in Game Development & Technology': [
    'Game Programming',
    'Game Design',
    'Game Development',
    'Game Engines',
    'Interactive Technology',
  ],
  'Common Design & Media Programme': [
    'Design Fundamentals',
    'Visual Communication',
    'Digital Media',
    'Design Thinking',
    'Creative Technology',
  ],

  // School of Engineering
  'Diploma in Advanced & Digital Manufacturing': [
    'Advanced Manufacturing',
    'Digital Manufacturing',
    'Automation',
    'Robotics',
    'Industry 4.0',
  ],
  'Diploma in Aerospace Engineering': [
    'Aerospace Engineering',
    'Aircraft Systems',
    'Aircraft Maintenance',
    'Aircraft Structures',
    'Avionics',
  ],
  'Diploma in AI & Data Engineering': [
    'Artificial Intelligence',
    'AI Modelling',
    'Data Engineering',
    'Robotics & Automation',
    'IoT',
  ],
  'Diploma in AI Robotics': [
    'Artificial Intelligence',
    'Robotics',
    'Automation',
    'Machine Learning',
    'Computer Vision',
  ],
  'Diploma in Biomedical Engineering': [
    'Biomedical Engineering',
    'Medical Devices',
    'Electronics',
    'Biomedical Instrumentation',
    'Healthcare Technology',
  ],
  'Diploma in Cloud Engineering': [
    'Cloud Computing',
    'Cloud Infrastructure',
    'Networking',
    'DevOps',
    'Cloud Security',
  ],
  'Diploma in Electronic & Computer Engineering': [
    'Electronics',
    'Computer Engineering',
    'Embedded Systems',
    'Programming',
    'IoT',
  ],
  'Diploma in Sustainability in Engineering with Business': [
    'Sustainable Engineering',
    'Green Technology',
    'Business Management',
    'Energy Management',
    'Sustainability',
  ],
  'Common Engineering Programme': [
    'Engineering Mathematics',
    'Engineering Science',
    'Engineering Design',
    'Programming',
    'Electronics',
  ],

  // School of Health & Social Sciences
  'Diploma in Nursing': [
    'Nursing',
    'Anatomy & Physiology',
    'Patient Care',
    'Pharmacology',
    'Clinical Practice',
  ],
  'Diploma in Oral Health Therapy': [
    'Dental Science',
    'Oral Health',
    'Dental Hygiene',
    'Clinical Practice',
    'Preventive Dentistry',
  ],
  'Diploma in Social Work': [
    'Social Work',
    'Psychology',
    'Sociology',
    'Counselling',
    'Community Work',
  ],

  // School of Information Technology
  'Diploma in Applied AI & Analytics': [
    'Artificial Intelligence',
    'Data Analytics',
    'Machine Learning',
    'Data Engineering',
    'Full Stack Development',
  ],
  'Diploma in Business & Financial Technology': [
    'FinTech',
    'Banking & Finance',
    'Programming',
    'Data Analytics',
    'Digital Banking',
  ],
  'Diploma in Computing': [
    'Programming',
    'Full Stack Development',
    'Software Development',
    'Database Systems',
    'Cloud Computing',
  ],
  'Diploma in Cybersecurity & Digital Forensics': [
    'Cybersecurity',
    'Digital Forensics',
    'Ethical Hacking',
    'Network Security',
    'Secure Software Development',
  ],
  'Common ICT Programme': ['Programming', 'Computing', 'Networking', 'Data', 'Web Development'],
}

/**
 * Starting vocabulary for the specific things students get stuck on inside a
 * competency. These are ordinary subject terms, NOT an official NYP syllabus —
 * they exist so the topic pickers are not empty. Anyone can type their own, and
 * competencies missing from this map simply start with a blank list.
 */
export const TOPIC_SUGGESTIONS: Record<string, string[]> = {
  'Database Systems': [
    'SQL joins',
    'subqueries',
    'normalisation',
    'indexing',
    'transactions',
    'ER modelling',
  ],
  Programming: ['recursion', 'loops', 'functions', 'debugging', 'file handling', 'unit testing'],
  'Software Development': ['OOP', 'design patterns', 'testing', 'version control', 'refactoring'],
  'Full Stack Development': ['React', 'REST APIs', 'authentication', 'state management', 'deployment'],
  'Web Development': ['HTML & CSS', 'JavaScript', 'responsive layout', 'forms', 'accessibility'],
  'Cloud Computing': ['AWS core services', 'serverless', 'containers', 'CI/CD', 'cost management'],
  'Data Analytics': ['probability', 'hypothesis testing', 'regression', 'dashboards', 'data cleaning'],
  'Machine Learning': ['supervised learning', 'model evaluation', 'feature engineering', 'overfitting'],
  'Artificial Intelligence': ['search algorithms', 'neural networks', 'prompt design', 'model ethics'],
  Cybersecurity: ['threat modelling', 'cryptography', 'access control', 'incident response'],
  Networking: ['TCP/IP', 'subnetting', 'routing', 'DNS', 'firewalls'],
  Mathematics: ['algebra', 'calculus', 'probability', 'matrices', 'statistics'],
  'Engineering Mathematics': ['calculus', 'differential equations', 'matrices', 'complex numbers'],
  'Financial Accounting': ['journal entries', 'trial balance', 'financial statements', 'depreciation'],
  'UX Design': ['user research', 'wireframing', 'usability testing', 'information architecture'],
  'Laboratory Techniques': ['titration', 'chromatography', 'sample preparation', 'lab safety'],
  'Anatomy & Physiology': ['cardiovascular system', 'respiratory system', 'nervous system'],
}

export interface ModuleInfo {
  /** Slug of the competency name, e.g. "database-systems". */
  moduleId: string
  /** The competency itself, e.g. "Database Systems". */
  moduleName: string
  /** Every course that lists this competency. */
  diplomas: string[]
  /** Suggested topics; may be empty, in which case students type their own. */
  topics: string[]
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Every competency once, with the courses that teach it. Built from
 * DIPLOMA_COMPETENCIES so the two can never fall out of step.
 */
export const MODULES: ModuleInfo[] = (() => {
  const byName = new Map<string, ModuleInfo>()
  for (const [course, competencies] of Object.entries(DIPLOMA_COMPETENCIES)) {
    for (const name of competencies) {
      const existing = byName.get(name)
      if (existing) {
        existing.diplomas.push(course)
      } else {
        byName.set(name, {
          moduleId: slug(name),
          moduleName: name,
          diplomas: [course],
          topics: TOPIC_SUGGESTIONS[name] ?? [],
        })
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName))
})()

export function findModule(moduleId: string): ModuleInfo | undefined {
  return MODULES.find((m) => m.moduleId === moduleId)
}

/** Competencies listed by a given course, in the order the course lists them. */
export function modulesForCourse(course: string): ModuleInfo[] {
  return (DIPLOMA_COMPETENCIES[course] ?? [])
    .map((name) => MODULES.find((m) => m.moduleName === name))
    .filter((m): m is ModuleInfo => Boolean(m))
}

/**
 * Two competencies are related when at least one course teaches both — a real
 * link from the curriculum rather than a guess from the name.
 */
export function areRelatedModules(a: string, b: string): boolean {
  if (a === b) return false
  const first = findModule(a)
  const second = findModule(b)
  if (!first || !second) return false
  return first.diplomas.some((course) => second.diplomas.includes(course))
}

/**
 * Options for a competency picker: the student's own course first, everything
 * else after. Returns [group label, competencies] pairs for <optgroup>.
 */
export function moduleOptions(course: string | undefined, pool = MODULES): [string, ModuleInfo[]][] {
  const own = course ? modulesForCourse(course).filter((m) => pool.includes(m)) : []
  const rest = pool.filter((m) => !own.includes(m))
  const groups: [string, ModuleInfo[]][] = []
  if (own.length) groups.push([`Your course — ${course}`, own])
  if (rest.length) groups.push([own.length ? 'All other competencies' : 'All competencies', rest])
  return groups
}
