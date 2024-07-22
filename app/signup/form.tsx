"use client";
import { api } from "@/trpc/react";
import { Button, Flex, TextFieldInput, TextFieldRoot } from "frosted-ui";
import { FormEvent } from "react";

export default function Form() {
  const registerMutation = api.auth.register.useMutation({
    onSuccess: (data) => {
      console.log(data);
    },
  });

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    registerMutation.mutate({
      email: formData.get("email") as string,
      password: formData.get("password") as string,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <Flex direction="column" gap="4">
        <TextFieldRoot>
          <TextFieldInput
            name="email"
            variant="classic"
            size="3"
            placeholder="Enter your email"
            type="email"
            required
          />
        </TextFieldRoot>
        <TextFieldRoot>
          <TextFieldInput
            name="password"
            variant="classic"
            size="3"
            placeholder="Enter your password"
            type="password"
            required
          />
        </TextFieldRoot>
        <Button
          type="submit"
          style={{ cursor: "pointer" }}
          size="3"
          color="orange"
          variant="classic"
          className="w-full"
        >
          Sign up
        </Button>
      </Flex>
    </form>
  );
}
