#!/bin/bash

# Fix All Type Errors Loop Script
# Continuously invokes Claude Code to fix TypeScript errors until there are zero

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter for iterations
ITERATION=0

# Function to count TypeScript errors
count_errors() {
    npx tsc --noEmit 2>&1 | grep -E "error TS" | wc -l | tr -d '[:space:]'
}

# Function to get error summary
get_error_summary() {
    npx tsc --noEmit 2>&1 | grep -E "TS[0-9]{4}" | sed 's/.*\(TS[0-9]\{4\}\).*/\1/' | sort | uniq -c | sort -rn | head -5
}

# Initial error count
INITIAL_ERRORS=$(count_errors)
echo -e "${YELLOW}Starting with $INITIAL_ERRORS TypeScript errors${NC}\n"

# Main loop
while true; do
    ITERATION=$((ITERATION + 1))
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}"
    echo -e "${YELLOW}Iteration $ITERATION: Checking for TypeScript errors...${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════════════════${NC}\n"

    # Count current errors
    ERROR_COUNT=$(count_errors)

    if [ "$ERROR_COUNT" -eq "0" ]; then
        echo -e "${YELLOW}No errors before Claude; running Claude once, then re-checking...${NC}"
    else
        echo -e "${RED}Found $ERROR_COUNT TypeScript errors${NC}"
        echo -e "${YELLOW}Top error types:${NC}"
        get_error_summary
        echo ""
    fi

    # Create a detailed prompt for Claude Code
    PROMPT="Continue fixing ALL remaining TypeScript errors until there are ZERO errors. Do not stop until 'npx tsc --noEmit' returns no errors.

Current status: $ERROR_COUNT TypeScript errors remaining.

Top error types:
$(get_error_summary)

Sample errors:
$(npx tsc --noEmit 2>&1 | head -20)

Instructions:
1. Fix ALL TypeScript compilation errors
2. Focus on the most common error types first
3. Fix corrupted syntax from linter (e.g., '| undefined' in wrong places)
4. Ensure all imports are correct
5. Fix all Effect type mismatches
6. Do NOT stop until all errors are resolved
7. You must not violate idiomatic Effect usage
8. Run 'npx tsc --noEmit' to verify zero errors before finishing"

    echo -e "${YELLOW}Invoking Claude Code to fix errors...${NC}\n"

    # Invoke Claude Code with the prompt
    # Using --print for non-interactive mode
    claude --print --dangerously-skip-permissions "$PROMPT" || true

    # Brief pause to ensure file system is synced
    sleep 2

    # Check if errors were reduced
    NEW_ERROR_COUNT=$(count_errors)

    if [ "$NEW_ERROR_COUNT" -eq "$ERROR_COUNT" ]; then
        echo -e "${RED}Warning: Error count did not decrease. Trying again with more specific prompt...${NC}"

        # More aggressive prompt if no progress
        PROMPT="CRITICAL: TypeScript errors are not decreasing. You MUST fix these errors NOW.

Error count stuck at: $ERROR_COUNT

First 50 errors:
$(npx tsc --noEmit 2>&1 | head -50)

REQUIRED ACTIONS:
1. Read the actual error messages carefully
2. Fix the ROOT CAUSE of each error type
3. Check for syntax corruption from linting
4. Fix import statements
5. Add type assertions where needed
6. Modify tsconfig.json if absolutely necessary
7. You must not violate idiomatic Effect usage
8. DO NOT STOP until 'npx tsc --noEmit' shows ZERO errors"

        claude --print --dangerously-skip-permissions "$PROMPT" || true
        sleep 2

        NEW_ERROR_COUNT=$(count_errors)
        if [ "$NEW_ERROR_COUNT" -eq "$ERROR_COUNT" ]; then
            echo -e "${RED}Error count still not decreasing. Manual intervention may be required.${NC}"
            echo -e "${RED}Remaining errors: $NEW_ERROR_COUNT${NC}"
            exit 1
        fi
    fi

    # Exit immediately if we reached zero to avoid an extra loop iteration
    if [ "$NEW_ERROR_COUNT" -eq "0" ]; then
        echo -e "${GREEN}✨ SUCCESS! Zero TypeScript errors!${NC}"
        echo -e "${GREEN}Fixed all errors in $ITERATION iterations${NC}"
        exit 0
    fi

    echo -e "${GREEN}Progress: Reduced from $ERROR_COUNT to $NEW_ERROR_COUNT errors${NC}\n"

    # Safety check to prevent infinite loops
    if [ "$ITERATION" -gt 20 ]; then
        echo -e "${RED}Reached maximum iterations (20). Manual intervention required.${NC}"
        echo -e "${RED}Remaining errors: $NEW_ERROR_COUNT${NC}"
        exit 1
    fi
done
