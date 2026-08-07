with open('server/routers.ts', 'r') as f:
    content = f.read()

# The problem: the patch added the new routers AFTER the closing }); of appRouter
# AND left a duplicate planTabs.delete block
# We need to:
# 1. Remove the closing }); at line 385
# 2. Remove the duplicate planTabs.delete block (lines 386-392)
# 3. Keep the new routers
# 4. Add the proper closing }); at the end

# Find and remove the premature closing and duplicate block
old_broken = '''      }),
  }),
});
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await db.deletePlanTab(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  cutouts:'''

new_fixed = '''      }),
  }),

  cutouts:'''

if old_broken in content:
    content = content.replace(old_broken, new_fixed, 1)
    print("Fixed duplicate block")
else:
    print("ERROR: could not find broken block")
    # Show the area
    idx = content.find('});')
    print("First }); at:", idx)
    print("Context:", repr(content[idx-50:idx+200]))

with open('server/routers.ts', 'w') as f:
    f.write(content)
print("Done")
