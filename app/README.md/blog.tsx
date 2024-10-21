import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import slug from "rehype-slug";
import Link from "next/link";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import SyntaxHighlighter from "react-syntax-highlighter";
import { monokai } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { Button } from "frosted-ui";

export default function Blog({
  md,
  date,
  title,
}: {
  md: string;
  date: string;
  title: string;
}) {
  return (
    <>
      <div className="grow">
        <div className="flex flex-col px-4 mx-auto max-w-[800px] w-full pt-12 pb-8 min-h-[90vh]">
          <Link className="cursor-pointer py-2" href={"/"}>
            <Button style={{ cursor: "pointer" }} variant="surface">
              home
            </Button>
          </Link>
          <p className="text-primary/60 pb-4">{date}</p>
          <h1 className="border-b text-3xl pb-8">{title}</h1>
          <div className="prose prose-slate pt-12 dark:prose-invert">
            <Markdown
              components={{
                p: ({ children, className, ...props }) => (
                  <p
                    className={`text-lg text-primary/80 py-2 ${className}`}
                    {...props}
                  >
                    {children}
                  </p>
                ),
                h1: ({ children, className, ...props }) => (
                  <h1 className={`text-3xl py-4 ${className}`} {...props}>
                    {children}
                  </h1>
                ),
                h2: ({ children, className, ...props }) => (
                  <h2 className={`text-2xl py-2 ${className}`} {...props}>
                    {children}
                  </h2>
                ),
                h3: ({ children, className, ...props }) => (
                  <h3 className={`text-xl py-2 ${className}`} {...props}>
                    {children}
                  </h3>
                ),
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className ?? "");
                  return match ? (
                    <div>
                      {/* @ts-ignore */}
                      <SyntaxHighlighter style={monokai} language={match[1]}>
                        {children}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                a: ({ href, children }) => (
                  <Link
                    href={href ?? ""}
                    className="underline underline-offset-4"
                  >
                    {children}
                  </Link>
                ),
              }}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[
                rehypeKatex,
                rehypeRaw,
                slug,
                [
                  rehypeAutolinkHeadings,
                  {
                    behavior: "wrap",
                  },
                ],
              ]}
            >
              {md}
            </Markdown>
          </div>
        </div>
      </div>
    </>
  );
}
