/* eslint-disable @next/next/no-img-element -- Demo media uses browser data URLs. */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  ImagePlus,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { asLamports, formatSol, parseSol } from "@/lib/amounts";
import {
  CATEGORIES,
  DEMO_IDENTITIES,
  type Project,
  type ProjectInput,
} from "@/types/project";
import "./editor.css";

const steps = [
  "Basic information",
  "Media",
  "Funding & plan",
  "Milestones",
  "Review",
];
const MAX_IMAGE_BYTES = 400 * 1024;
type EditableMilestone = { title: string; description: string; amount: string };
type EditorValues = {
  title: string;
  shortDescription: string;
  description: string;
  category: string;
  logoUrl: string;
  coverUrl: string;
  gallery: string[];
  goal: string;
  plan: { what: string; why: string; audience: string; roadmap: string };
  links: { website: string; github: string; demo: string };
  milestones: EditableMilestone[];
};

function editorValues(project?: Project): EditorValues {
  return {
    title: project?.title ?? "",
    shortDescription: project?.shortDescription ?? "",
    description: project?.description ?? "",
    category: project?.category ?? "Technology",
    logoUrl: project?.logoUrl ?? "",
    coverUrl: project?.coverUrl ?? "",
    gallery: project?.gallery ?? [],
    goal: project ? formatSol(project.goal) : "10",
    plan: project?.plan ?? { what: "", why: "", audience: "", roadmap: "" },
    links: {
      website: project?.links.website ?? "",
      github: project?.links.github ?? "",
      demo: project?.links.demo ?? "",
    },
    milestones: project?.milestones.map((milestone) => ({
      title: milestone.title,
      description: milestone.description,
      amount: formatSol(milestone.amount),
    })) ?? [{ title: "", description: "", amount: "10" }],
  };
}

function checkedLink(value: string, label: string): string {
  if (!value.trim()) return "";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a complete http:// or https:// URL.`);
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`${label} must use http:// or https://.`);
  return url.href;
}

function readImage(file: File): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    return Promise.reject(new Error("Choose a PNG, JPEG or WebP image."));
  if (file.size > MAX_IMAGE_BYTES)
    return Promise.reject(
      new Error(
        "Each image must be 400 KB or smaller so the demo can save it in this browser.",
      ),
    );
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(
        new Error("This image could not be read. Please choose it again."),
      );
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Could not load image."));
    reader.readAsDataURL(file);
  });
}

export function ProjectEditor({ projectId }: { projectId?: string }) {
  const context = useProjects();
  if (!context.state || !context.repository)
    return (
      <section className="of-container of-page">
        <p role="status">Loading project editor…</p>
      </section>
    );
  const identity = DEMO_IDENTITIES.find(
    (item) => item.id === context.state?.identityId,
  );
  const project = projectId
    ? context.state.projects.find((item) => item.id === projectId)
    : undefined;
  if (projectId && !project)
    return (
      <section className="of-container of-page">
        <div className="of-empty">
          <h1>Project not found</h1>
          <p>This project may have been removed when demo data was reset.</p>
          <Link className="of-button" href="/dashboard">
            Open dashboard
          </Link>
        </div>
      </section>
    );
  if (
    identity?.id !== "creator" ||
    (project && project.creatorId !== identity.id)
  )
    return (
      <section className="of-container of-page">
        <div className="of-card editor-gate">
          <span className="of-eyebrow">Creator workspace</span>
          <h1 className="of-page-title">
            {project
              ? "Only this project’s creator can edit it"
              : "Bring your next idea to life"}
          </h1>
          <p className="of-subtitle">
            {project
              ? "Editing is available only to the owner of this project. The Creator demo identity can edit projects it created."
              : "Select Creator in the Demo User menu to start a project. Your draft and images will be saved in this browser."}
          </p>
          {!project && (
            <button
              className="of-button"
              onClick={() => context.setIdentity("creator")}
            >
              Use Creator demo identity
            </button>
          )}
          <Link className="of-button secondary" href="/projects">
            Explore projects
          </Link>
        </div>
      </section>
    );
  return <EditorForm key={project?.id ?? "new-project"} project={project} />;
}

function EditorForm({ project }: { project?: Project }) {
  const { repository, pending, run } = useProjects();
  const router = useRouter();
  const [values, setValues] = useState<EditorValues>(() =>
    editorValues(project),
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savedId, setSavedId] = useState(project?.id);
  const heading = useRef<HTMLHeadingElement>(null);
  const funded = !!project && asLamports(project.raised) > 0n;
  const published = !!project && project.status !== "draft";
  const busy = pending || uploading;
  function change<K extends keyof EditorValues>(
    key: K,
    value: EditorValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setError("");
  }
  function changeMilestone(
    index: number,
    key: keyof EditableMilestone,
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      milestones: current.milestones.map((milestone, i) =>
        i === index ? { ...milestone, [key]: value } : milestone,
      ),
    }));
    setError("");
  }
  function goTo(next: number) {
    setStep(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  let allocated = 0n;
  let goal = 0n;
  let validBudget = true;
  try {
    goal = asLamports(parseSol(values.goal));
    for (const milestone of values.milestones)
      allocated += asLamports(parseSol(milestone.amount));
  } catch {
    validBudget = false;
  }
  const remaining = goal - allocated;

  function input(publish: boolean): ProjectInput {
    if (!values.title.trim())
      throw new Error("Enter a project title in Basic information.");
    if (
      publish &&
      (!values.shortDescription.trim() || !values.description.trim())
    )
      throw new Error(
        "Add the short description and full project description before publishing.",
      );
    if (publish && Object.values(values.plan).some((value) => !value.trim()))
      throw new Error(
        "Complete all four project plan fields before publishing.",
      );
    const goalLamports = parseSol(values.goal);
    const milestones = values.milestones.map((milestone, i) => {
      if (!milestone.title.trim())
        throw new Error(`Give milestone ${i + 1} a title before saving.`);
      if (publish && !milestone.description.trim())
        throw new Error(
          `Add a description for milestone ${i + 1} before publishing.`,
        );
      let amount: string;
      try {
        amount = parseSol(milestone.amount);
      } catch {
        throw new Error(
          `Milestone ${i + 1} needs a positive SOL budget with up to 9 decimal places.`,
        );
      }
      return {
        title: milestone.title.trim(),
        description: milestone.description.trim(),
        amount,
      };
    });
    const sum = milestones.reduce(
      (total, milestone) => total + asLamports(milestone.amount),
      0n,
    );
    if (sum > asLamports(goalLamports))
      throw new Error(
        "Milestone budgets cannot exceed the project funding goal.",
      );
    return {
      title: values.title.trim(),
      shortDescription: values.shortDescription.trim(),
      description: values.description.trim(),
      category: values.category,
      logoUrl: values.logoUrl || undefined,
      coverUrl: values.coverUrl || undefined,
      gallery: values.gallery,
      goal: goalLamports,
      plan: {
        what: values.plan.what.trim(),
        why: values.plan.why.trim(),
        audience: values.plan.audience.trim(),
        roadmap: values.plan.roadmap.trim(),
      },
      links: {
        website: checkedLink(values.links.website, "Website URL"),
        github: checkedLink(values.links.github, "GitHub URL"),
        demo: checkedLink(values.links.demo, "Demo URL"),
      },
      milestones,
    };
  }
  async function save(publish: boolean) {
    if (!repository || busy) return;
    let payload: ProjectInput;
    try {
      payload = input(publish || published);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Review the form and try again.",
      );
      return;
    }
    let id = savedId;
    const success = await run(
      () => {
        if (id) {
          repository.updateProject(id, payload, publish && !published);
        } else {
          const created = repository.createProject(payload, publish);
          id = created.id;
        }
      },
      publish
        ? "Project published. It is now visible in Explore Projects."
        : published
          ? "Project changes saved."
          : "Draft saved in this browser.",
    );
    if (success && id) {
      setSavedId(id);
      router.push(
        publish || published ? `/projects/${id}` : `/projects/${id}/edit`,
      );
    }
  }
  async function upload(
    files: FileList | null,
    target: "logoUrl" | "coverUrl" | "gallery",
  ) {
    if (!files?.length || busy) return;
    setUploading(true);
    setError("");
    try {
      const list = Array.from(files);
      if (target === "gallery" && values.gallery.length + list.length > 3)
        throw new Error("Choose up to 3 gallery images in total.");
      const images = await Promise.all(list.map(readImage));
      if (target === "gallery")
        change("gallery", [...values.gallery, ...images]);
      else change(target, images[0]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load the selected image.",
      );
    } finally {
      setUploading(false);
    }
  }
  return (
    <section className="of-container of-page editor-page">
      <Link href="/dashboard" className="editor-back">
        <ArrowLeft size={15} aria-hidden="true" /> My dashboard
      </Link>
      <div className="editor-heading">
        <div>
          <p className="of-eyebrow">Creator workspace</p>
          <h1 className="of-page-title">
            {project ? "Edit project" : "Create a project"}
          </h1>
          <p className="of-subtitle">
            Turn a clear plan into progress your backers can follow.
          </p>
        </div>
        <span className="of-badge">Local demo · saved in this browser</span>
      </div>
      <div className="editor-layout">
        <nav className="editor-steps" aria-label="Project creation steps">
          <ol>
            {steps.map((label, index) => (
              <li key={label}>
                <button
                  type="button"
                  aria-current={step === index ? "step" : undefined}
                  className={step === index ? "active" : ""}
                  onClick={() => goTo(index)}
                  disabled={busy}
                >
                  <span className="editor-step-number">
                    {index < step ? (
                      <Check size={15} aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="editor-tip">
            <strong>A thoughtful plan builds trust.</strong>
            <p>
              Make each milestone specific, measurable and easy for backers to
              review.
            </p>
          </div>
        </nav>
        <form
          className="of-card editor-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (step < 4) goTo(step + 1);
            else void save(!published);
          }}
        >
          <fieldset disabled={busy}>
            <div className="editor-section-heading">
              <p className="of-eyebrow">Step {step + 1} of 5</p>
              <h2 ref={heading} tabIndex={-1}>
                {step === 4 ? "Review your project" : steps[step]}
              </h2>
              <p className="of-muted">
                {
                  [
                    "Tell the story behind your project.",
                    "Give your project a recognizable identity.",
                    "Explain what the funding will make possible.",
                    "Break the work into clear, reviewable outcomes.",
                    "Check the details before sharing your project with backers.",
                  ][step]
                }
              </p>
            </div>
            {error && (
              <p className="editor-error" role="alert">
                {error}
              </p>
            )}
            {funded && (
              <p className="editor-info">
                Funding has started. You can update the project’s story and
                milestone descriptions; its goal and milestone budgets are
                fixed.
              </p>
            )}
            {step === 0 && (
              <div className="editor-fields">
                <label className="of-field">
                  Project title{" "}
                  <span className="editor-required" aria-hidden="true">
                    *
                  </span>
                  <input
                    aria-label="Project title"
                    name="title"
                    required
                    maxLength={100}
                    value={values.title}
                    onChange={(event) => change("title", event.target.value)}
                    placeholder="A name people will remember"
                  />
                </label>
                <label className="of-field">
                  Short description{" "}
                  <span className="editor-required" aria-hidden="true">
                    *
                  </span>
                  <textarea
                    aria-label="Short description"
                    name="shortDescription"
                    required
                    maxLength={240}
                    rows={2}
                    value={values.shortDescription}
                    onChange={(event) =>
                      change("shortDescription", event.target.value)
                    }
                    placeholder="Your idea in one or two sentences"
                  />
                  <small>{values.shortDescription.length}/240 characters</small>
                </label>
                <label className="of-field">
                  Full project description{" "}
                  <span className="editor-required" aria-hidden="true">
                    *
                  </span>
                  <textarea
                    aria-label="Full project description"
                    name="description"
                    required
                    maxLength={6000}
                    rows={6}
                    value={values.description}
                    onChange={(event) =>
                      change("description", event.target.value)
                    }
                    placeholder="Describe the opportunity, your approach and the impact you want to make."
                  />
                </label>
                <label className="of-field">
                  Category
                  <select
                    name="category"
                    value={values.category}
                    onChange={(event) => change("category", event.target.value)}
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {step === 1 && (
              <div className="editor-fields">
                <p className="editor-info">
                  Images stay in this browser. PNG, JPEG or WebP; up to 400 KB
                  each. No external upload service is used.
                </p>
                <div className="editor-media-grid">
                  <MediaField
                    label="Project logo"
                    value={values.logoUrl}
                    onUpload={(files) => void upload(files, "logoUrl")}
                    onRemove={() => change("logoUrl", "")}
                  />
                  <MediaField
                    label="Cover image"
                    value={values.coverUrl}
                    onUpload={(files) => void upload(files, "coverUrl")}
                    onRemove={() => change("coverUrl", "")}
                    cover
                  />
                </div>
                <label className="of-field">
                  Gallery images (optional)
                  <input
                    aria-label="Gallery images (optional)"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(event) => {
                      void upload(event.target.files, "gallery");
                      event.target.value = "";
                    }}
                    disabled={values.gallery.length >= 3 || busy}
                  />
                  <small>
                    Up to 3 images. {values.gallery.length}/3 added.
                  </small>
                </label>
                {!!values.gallery.length && (
                  <div className="editor-gallery">
                    {values.gallery.map((url, index) => (
                      <div key={`${index}-${url.slice(-20)}`}>
                        <img src={url} alt={`Gallery preview ${index + 1}`} />
                        <button
                          type="button"
                          className="editor-text-button"
                          onClick={() =>
                            change(
                              "gallery",
                              values.gallery.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" /> Remove image{" "}
                          {index + 1}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {uploading && <p role="status">Preparing image preview…</p>}
              </div>
            )}
            {step === 2 && (
              <div className="editor-fields">
                <label className="of-field">
                  Funding goal (SOL){" "}
                  <span className="editor-required" aria-hidden="true">
                    *
                  </span>
                  <div className="editor-amount">
                    <input
                      aria-label="Funding goal (SOL)"
                      name="goal"
                      inputMode="decimal"
                      required
                      value={values.goal}
                      disabled={funded}
                      onChange={(event) => change("goal", event.target.value)}
                      placeholder="10"
                    />
                    <span>SOL</span>
                  </div>
                  <small>
                    Use a positive amount with up to 9 decimal places.
                  </small>
                </label>
                <div className="editor-divider" />
                {(
                  [
                    ["what", "What are we building?"],
                    ["why", "Why is it needed?"],
                    ["audience", "Who is it for?"],
                    ["roadmap", "Project plan / roadmap"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="of-field">
                    {label}{" "}
                    <span className="editor-required" aria-hidden="true">
                      *
                    </span>
                    <textarea
                      aria-label={label}
                      required
                      maxLength={3000}
                      rows={key === "roadmap" ? 4 : 2}
                      value={values.plan[key]}
                      onChange={(event) =>
                        change("plan", {
                          ...values.plan,
                          [key]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
                <div className="editor-divider" />
                <h3>
                  Project links <span className="of-muted">(optional)</span>
                </h3>
                {(
                  [
                    ["website", "Website URL"],
                    ["github", "GitHub URL"],
                    ["demo", "Demo URL"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="of-field">
                    {label}
                    <input
                      aria-label={label}
                      type="url"
                      value={values.links[key]}
                      maxLength={2000}
                      onChange={(event) =>
                        change("links", {
                          ...values.links,
                          [key]: event.target.value,
                        })
                      }
                      placeholder="https://"
                    />
                  </label>
                ))}
              </div>
            )}
            {step === 3 && (
              <div className="editor-fields">
                <div
                  className="editor-budget"
                  aria-label="Milestone budget summary"
                >
                  <div>
                    <span>Total goal</span>
                    <strong>
                      {validBudget
                        ? formatSol(goal.toString())
                        : values.goal || "—"}{" "}
                      SOL
                    </strong>
                  </div>
                  <div>
                    <span>Allocated</span>
                    <strong>
                      {validBudget ? formatSol(allocated.toString()) : "—"} SOL
                    </strong>
                  </div>
                  <div
                    className={
                      validBudget && remaining < 0n ? "over-budget" : ""
                    }
                  >
                    <span>{remaining < 0n ? "Over budget" : "Remaining"}</span>
                    <strong>
                      {validBudget
                        ? formatSol(
                            (remaining < 0n
                              ? -remaining
                              : remaining
                            ).toString(),
                          )
                        : "—"}{" "}
                      SOL
                    </strong>
                  </div>
                </div>
                {validBudget && remaining < 0n && (
                  <p role="alert" className="editor-error">
                    Allocated milestone budgets exceed the funding goal. Reduce
                    the budgets or increase the goal.
                  </p>
                )}
                {values.milestones.map((milestone, index) => (
                  <section
                    key={index}
                    className="editor-milestone"
                    aria-label={`Milestone ${index + 1}`}
                  >
                    <div className="editor-milestone-heading">
                      <h3>
                        <span>{index + 1}</span>Milestone {index + 1}
                      </h3>
                      <button
                        type="button"
                        className="editor-text-button"
                        aria-label={`Remove milestone ${index + 1}`}
                        disabled={funded || values.milestones.length === 1}
                        onClick={() =>
                          change(
                            "milestones",
                            values.milestones.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 size={14} aria-hidden="true" /> Remove
                      </button>
                    </div>
                    <label className="of-field">
                      Milestone {index + 1} title
                      <input
                        aria-label={`Milestone ${index + 1} title`}
                        required
                        maxLength={120}
                        value={milestone.title}
                        onChange={(event) =>
                          changeMilestone(index, "title", event.target.value)
                        }
                        placeholder={index === 0 ? "Prototype" : "Next outcome"}
                      />
                    </label>
                    <label className="of-field">
                      Milestone {index + 1} description
                      <textarea
                        aria-label={`Milestone ${index + 1} description`}
                        maxLength={2000}
                        rows={2}
                        value={milestone.description}
                        onChange={(event) =>
                          changeMilestone(
                            index,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder="What will be completed and how will you demonstrate it?"
                      />
                    </label>
                    <label className="of-field">
                      Milestone {index + 1} budget (SOL)
                      <div className="editor-amount">
                        <input
                          aria-label={`Milestone ${index + 1} budget (SOL)`}
                          required
                          inputMode="decimal"
                          value={milestone.amount}
                          disabled={funded}
                          onChange={(event) =>
                            changeMilestone(index, "amount", event.target.value)
                          }
                        />
                        <span>SOL</span>
                      </div>
                    </label>
                  </section>
                ))}
                <button
                  type="button"
                  className="of-button secondary editor-add"
                  disabled={funded || values.milestones.length >= 5}
                  onClick={() =>
                    change("milestones", [
                      ...values.milestones,
                      { title: "", description: "", amount: "" },
                    ])
                  }
                >
                  <Plus size={16} aria-hidden="true" /> Add Milestone
                </button>
                <p className="of-muted editor-small">
                  {values.milestones.length} of 5 milestones. Budgets must be
                  positive and fit within your funding goal.
                </p>
              </div>
            )}
            {step === 4 && (
              <div className="editor-preview" aria-label="Project preview">
                {values.coverUrl ? (
                  <img
                    src={values.coverUrl}
                    className="editor-preview-cover"
                    alt="Project cover preview"
                  />
                ) : (
                  <div className="editor-preview-cover-placeholder">
                    <ImagePlus size={32} aria-hidden="true" />
                    <span>No cover selected</span>
                  </div>
                )}
                <div className="editor-preview-title">
                  {values.logoUrl && (
                    <img src={values.logoUrl} alt="Project logo preview" />
                  )}
                  <div>
                    <span className="of-badge">{values.category}</span>
                    <h3>{values.title || "Your project title"}</h3>
                  </div>
                </div>
                <p className="editor-preview-description">
                  {values.shortDescription ||
                    "Add a short description in Basic information."}
                </p>
                <p className="editor-preserve-lines">
                  {values.description ||
                    "Your full project story will appear here."}
                </p>
                <div className="editor-budget">
                  <div>
                    <span>Funding goal</span>
                    <strong>{values.goal || "—"} SOL</strong>
                  </div>
                  <div>
                    <span>Milestones</span>
                    <strong>{values.milestones.length}</strong>
                  </div>
                  <div>
                    <span>Allocated</span>
                    <strong>
                      {validBudget ? formatSol(allocated.toString()) : "—"} SOL
                    </strong>
                  </div>
                </div>
                <h3>The plan</h3>
                {(
                  [
                    ["what", "What we are building"],
                    ["why", "Why it matters"],
                    ["audience", "Who it is for"],
                    ["roadmap", "Roadmap"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <h4>{label}</h4>
                    <p className="editor-preserve-lines">
                      {values.plan[key] || "Not added yet"}
                    </p>
                  </div>
                ))}
                <h3>Milestones</h3>
                <ol className="editor-review-milestones">
                  {values.milestones.map((milestone, index) => (
                    <li key={index}>
                      <div>
                        <strong>
                          {milestone.title || `Milestone ${index + 1}`}
                        </strong>
                        <p>
                          {milestone.description ||
                            "Add a completion description."}
                        </p>
                      </div>
                      <span>{milestone.amount || "—"} SOL</span>
                    </li>
                  ))}
                </ol>
                {(values.links.website ||
                  values.links.github ||
                  values.links.demo) && (
                  <div>
                    <h3>Project links</h3>
                    {Object.entries(values.links)
                      .filter(([, value]) => !!value)
                      .map(([key, value]) => (
                        <p key={key} className="editor-preview-link">
                          <strong>{key}: </strong>
                          {value}
                        </p>
                      ))}
                  </div>
                )}
                {!!values.gallery.length && (
                  <div className="editor-gallery">
                    {values.gallery.map((url, index) => (
                      <img
                        key={index}
                        src={url}
                        alt={`Project gallery preview ${index + 1}`}
                      />
                    ))}
                  </div>
                )}
                <p className="editor-info">
                  Publishing makes this project available in your local demo.
                  Contributions, votes and releases in this app use demo
                  balances.
                </p>
              </div>
            )}
            <div className="editor-actions">
              <div>
                <button
                  type="button"
                  className="of-button secondary"
                  onClick={() => void save(false)}
                >
                  <Save size={15} aria-hidden="true" />
                  {published ? "Save Changes" : "Save Draft"}
                </button>
                {step < 4 && (
                  <button
                    type="button"
                    className="editor-text-button"
                    onClick={() => goTo(4)}
                  >
                    <Eye size={16} aria-hidden="true" /> Preview
                  </button>
                )}
              </div>
              <div>
                {step > 0 && (
                  <button
                    type="button"
                    className="of-button secondary"
                    onClick={() => goTo(step - 1)}
                  >
                    Back
                  </button>
                )}
                <button type="submit" className="of-button">
                  {pending
                    ? "Saving…"
                    : step === 4
                      ? published
                        ? "Save & View Project"
                        : "Publish Project"
                      : "Next"}
                  {step < 4 && <ArrowRight size={15} aria-hidden="true" />}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
}

function MediaField({
  label,
  value,
  onUpload,
  onRemove,
  cover = false,
}: {
  label: string;
  value: string;
  onUpload: (files: FileList | null) => void;
  onRemove: () => void;
  cover?: boolean;
}) {
  return (
    <div className="editor-media-field">
      <label className="of-field">
        {label}
        <div className={`editor-media-preview ${cover ? "cover" : ""}`}>
          {value ? (
            <img src={value} alt={`${label} preview`} />
          ) : (
            <>
              <ImagePlus size={28} aria-hidden="true" />
              <span>
                {cover
                  ? "Make a strong first impression"
                  : "A recognizable project identity"}
              </span>
            </>
          )}
        </div>
        <input
          aria-label={label}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            onUpload(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {value && (
        <button type="button" className="editor-text-button" onClick={onRemove}>
          <Trash2 size={14} aria-hidden="true" /> Remove {label.toLowerCase()}
        </button>
      )}
    </div>
  );
}
