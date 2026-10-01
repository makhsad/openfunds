"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { useProjects } from "@/hooks/use-projects";
import { ProjectCard } from "@/components/project-card";
import { CATEGORIES } from "@/types/project";

export function ProjectsExplore() {
  const { state } = useProjects();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const projects = (state?.projects ?? [])
    .filter(
      (p) =>
        p.status !== "draft" &&
        (category === "all" || p.category === category) &&
        (status === "all" || p.status === status) &&
        `${p.title} ${p.shortDescription} ${p.creatorName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <div className="of-container of-page">
      <div className="of-page-heading">
        <div>
          <p className="of-eyebrow">FIND YOUR NEXT BELIEF</p>
          <h1 className="of-page-title">Explore projects</h1>
          <p className="of-subtitle">
            Meet the builders turning good ideas into meaningful progress.
          </p>
        </div>
        <Link className="of-button secondary" href="/create">
          Start a project ↗
        </Link>
      </div>
      <div className="of-filters">
        <label className="of-search">
          <Search size={18} />
          <input
            aria-label="Search projects"
            placeholder="Search projects, ideas, or creators…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Category filter</span>
          <select
            aria-label="Category filter"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Status filter</span>
          <select
            aria-label="Status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="funding">In funding</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="of-sort">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Sort projects"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="title">Title A–Z</option>
          </select>
        </label>
      </div>
      <p className="of-results-count" role="status">
        {state
          ? `${projects.length} projects to discover`
          : "Loading projects…"}{" "}
        <span>All projects shown are local demo projects.</span>
      </p>
      {projects.length ? (
        <div className="of-project-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        state && (
          <div className="of-empty">
            <Search size={30} />
            <h2>No projects found</h2>
            <p>Try another search or reset the filters.</p>
            <button
              className="of-button secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setStatus("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )
      )}
    </div>
  );
}
