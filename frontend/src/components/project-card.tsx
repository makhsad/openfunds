/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ArrowUpRight, Flag, Users } from "lucide-react";
import type { Project } from "@/types/project";
import { formatSol, percentOf } from "@/lib/amounts";

export function ProjectCard({ project }: { project: Project }) {
  const percent = percentOf(project.raised, project.goal);
  const milestone = project.milestones.find(
    (item) => item.status !== "released",
  );
  return (
    <article className="of-project-card">
      <Link
        className="of-project-cover"
        href={`/projects/${project.id}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <img src={project.coverUrl || "/images/project-community.svg"} alt="" />
        <span className={`of-badge ${project.status}`}>
          {project.status === "funding" ? "In funding" : project.status}
        </span>
      </Link>
      <div className="of-project-card-body">
        <div className="of-project-title">
          <img
            className="of-project-avatar"
            src={project.logoUrl || "/images/project-community.svg"}
            alt=""
          />
          <div>
            <h2>
              <Link href={`/projects/${project.id}`}>{project.title}</Link>
            </h2>
            <p>{project.category}</p>
          </div>
          <ArrowUpRight size={17} aria-hidden="true" />
        </div>
        <p className="of-card-description">{project.shortDescription}</p>
        <p className="of-card-creator">by {project.creatorName}</p>
        <div className="of-card-amount">
          <span>
            <strong>{formatSol(project.raised)}</strong> /{" "}
            {formatSol(project.goal)} SOL
          </span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="of-progress"
          role="progressbar"
          aria-label={`${project.title} funding`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="of-card-meta">
          <span>
            <Users size={13} /> {project.backers} backers
          </span>
          <span>
            <Flag size={12} /> {milestone?.title ?? "Completed"}
          </span>
        </div>
      </div>
    </article>
  );
}
