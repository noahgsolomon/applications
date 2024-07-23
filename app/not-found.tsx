import { Button, Container, Flex, Heading } from "frosted-ui";
import Link from "next/link";

export default async function Page() {
  return (
    <div>
      <Container className="pt-36">
        <Flex
          className="w-full"
          align={"center"}
          direction={"column"}
          gap={"4"}
        >
          <Heading>Page not Found</Heading>
          <Link href={"/"}>
            <Button style={{ cursor: "pointer" }}>Go back</Button>
          </Link>
        </Flex>
      </Container>
    </div>
  );
}
