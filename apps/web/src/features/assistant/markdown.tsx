import type { Options } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNode = { type: string; children?: MarkdownNode[] };

/** Reads raw HTML as text, so `<tool>` placeholders in a note show as written instead of vanishing as tags. */
function remarkHtmlAsText() {
	const walk = (node: MarkdownNode) => {
		if (node.type === "html") node.type = "text";
		node.children?.forEach(walk);
	};
	return (tree: MarkdownNode) => walk(tree);
}

type AssistantMarkdownProps = {
	text: string;
	/** Show angle-bracket text such as `<tool>` literally instead of dropping it as HTML. */
	literalHtml?: boolean;
};

/**
 * The assistant's reply as Markdown, styled by the `typeset-chat` preset (streaming-safe: a new block never restyles
 * the ones above it). Memoized on the text, so finished replies stop re-rendering while one streams. Images render as
 * their alt text: a reply shaped by text the model read (a page, a posting) could otherwise load an image URL carrying
 * the user's data the moment it appears.
 */
export const AssistantMarkdown = function AssistantMarkdown({ text, literalHtml = false }: AssistantMarkdownProps) {
	const plugins: NonNullable<Options["remarkPlugins"]> = literalHtml ? [remarkGfm, remarkHtmlAsText] : [remarkGfm];
	return (
		<div className="typeset typeset-chat min-w-0">
			<ReactMarkdown
				skipHtml
				remarkPlugins={plugins}
				components={{
					a: ({ children, href }) => (
						<a href={href} target="_blank" rel="noreferrer">
							{children}
						</a>
					),
					table: ({ children }) => (
						<div className="typeset-scroll">
							<table>{children}</table>
						</div>
					),
					img: ({ alt }) => alt ?? null,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
};
